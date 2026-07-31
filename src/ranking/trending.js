import { pool } from "../db/client.js";

// Tunable: bigger DECAY_HOURS = stories stay "hot" longer.
// Score = (# distinct sources covering the story) / (1 + hoursSinceLastSeen / DECAY_HOURS)
// This rewards stories picked up by many outlets that are *still actively*
// being covered, and lets stale clusters fall off the front page on their own.
const DECAY_HOURS = 6;

export async function recomputeTrendingScores() {
  const { rows } = await pool.query(
    `SELECT
       c.id,
       COUNT(DISTINCT a.source_name) AS distinct_sources,
       EXTRACT(EPOCH FROM (now() - c.last_seen_at)) / 3600.0 AS hours_since_last_seen
     FROM clusters c
     JOIN articles a ON a.cluster_id = c.id
     WHERE c.last_seen_at > now() - interval '72 hours'
     GROUP BY c.id, c.last_seen_at`
  );

  const updates = rows.map((row) => {
    const score =
      Number(row.distinct_sources) / (1 + Number(row.hours_since_last_seen) / DECAY_HOURS);
    return { id: row.id, score };
  });

  // Simple sequential updates are fine at MVP volume (hundreds of clusters).
  // If this becomes a bottleneck, batch with a single UPDATE ... FROM VALUES.
  for (const { id, score } of updates) {
    await pool.query(`UPDATE clusters SET trending_score = $1 WHERE id = $2`, [score, id]);
  }

  return updates.length;
}

export async function getTrendingClusters({ category = null, limit = 40 } = {}) {
  const params = [];
  let where = `c.source_count >= 1`;
  if (category) {
    params.push(category);
    where += ` AND c.category = $${params.length}`;
  }
  params.push(limit);

  const { rows } = await pool.query(
    `SELECT
       c.id, c.representative_title, c.category, c.trending_score, c.last_seen_at,
       COUNT(DISTINCT a.source_name) AS source_count,
       (SELECT a2.url FROM articles a2 WHERE a2.cluster_id = c.id ORDER BY a2.published_at DESC NULLS LAST LIMIT 1) AS top_url,
       (SELECT a2.source_name FROM articles a2 WHERE a2.cluster_id = c.id ORDER BY a2.published_at DESC NULLS LAST LIMIT 1) AS top_source,
       (SELECT a2.image_url FROM articles a2 WHERE a2.cluster_id = c.id AND a2.image_url IS NOT NULL ORDER BY a2.published_at DESC NULLS LAST LIMIT 1) AS top_image
     FROM clusters c
     JOIN articles a ON a.cluster_id = c.id
     WHERE ${where}
     GROUP BY c.id
     ORDER BY c.trending_score DESC
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

/**
 * Fills `limit` slots for the header hero strip by going down a priority
 * list of tiers in order, taking each tier's top trending clusters (by
 * score) until the tier runs out or the slots run out, then moving to the
 * next tier. A tier with `category: null` matches any category (used for
 * an overall-trending catch-all tier). This means a tier that has enough
 * trending stories on its own can fill every slot — tiers below it only
 * get used to fill what's left over.
 *
 * `maxPerSource` caps how many slots any single outlet (a cluster's
 * `top_source`) can take, GLOBALLY across all tiers combined -- not reset
 * per tier. Without this, a tier whose top trending stories happen to be
 * dominated by one or two outlets fills the whole hero with just those
 * outlets. Because some rows will get skipped by this cap, each tier
 * overfetches candidates rather than requesting exactly `remaining`.
 */
export async function getTrendingClustersPriority({ tiers = [], limit = 10, maxPerSource = 1 } = {}) {
  const selected = [];
  const usedIds = new Set();
  const sourceCounts = new Map();

  for (const tier of tiers) {
    if (selected.length >= limit) break;
    const remaining = limit - selected.length;
    const overfetch = Math.max(remaining * 5, 30);

    const params = [];
    let where = `c.source_count >= 1`;
    if (tier.category) {
      params.push(tier.category);
      where += ` AND c.category = $${params.length}`;
    }
    if (usedIds.size > 0) {
      params.push(Array.from(usedIds));
      where += ` AND c.id != ALL($${params.length}::int[])`;
    }
    params.push(overfetch);

    const { rows } = await pool.query(
      `SELECT
         c.id, c.representative_title, c.category, c.trending_score, c.last_seen_at,
         COUNT(DISTINCT a.source_name) AS source_count,
         (SELECT a2.url FROM articles a2 WHERE a2.cluster_id = c.id ORDER BY a2.published_at DESC NULLS LAST LIMIT 1) AS top_url,
         (SELECT a2.source_name FROM articles a2 WHERE a2.cluster_id = c.id ORDER BY a2.published_at DESC NULLS LAST LIMIT 1) AS top_source,
         (SELECT a2.image_url FROM articles a2 WHERE a2.cluster_id = c.id AND a2.image_url IS NOT NULL ORDER BY a2.published_at DESC NULLS LAST LIMIT 1) AS top_image
       FROM clusters c
       JOIN articles a ON a.cluster_id = c.id
       WHERE ${where}
       GROUP BY c.id
       ORDER BY c.trending_score DESC
       LIMIT $${params.length}`,
      params
    );

    let takenThisTier = 0;
    for (const row of rows) {
      if (takenThisTier >= remaining) break;
      const count = sourceCounts.get(row.top_source) || 0;
      if (count >= maxPerSource) continue;

      selected.push(row);
      usedIds.add(row.id);
      sourceCounts.set(row.top_source, count + 1);
      takenThisTier++;
    }
  }

  return selected;
}

/**
 * Returns every distinct source name (A-Z) with its most recent articles,
 * for the sidebar's alphabetical source list + dropdown. Uses a single
 * windowed query instead of one query per source so this stays fast even
 * over a remote/public-proxy database connection.
 */
export async function getSourceIndex({ perSourceLimit = 5 } = {}) {
  const { rows } = await pool.query(
    `SELECT source_name, title, url, published_at FROM (
       SELECT
         source_name, title, url, published_at,
         ROW_NUMBER() OVER (PARTITION BY source_name ORDER BY published_at DESC NULLS LAST) AS rn
       FROM articles
     ) ranked
     WHERE rn <= $1
     ORDER BY source_name ASC, published_at DESC NULLS LAST`,
    [perSourceLimit]
  );

  const bySource = new Map();
  for (const row of rows) {
    if (!bySource.has(row.source_name)) bySource.set(row.source_name, []);
    bySource.get(row.source_name).push({ title: row.title, url: row.url });
  }

  return Array.from(bySource.entries())
    .map(([name, articles]) => ({ name, articles }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Returns state news grouped by state (A-Z by full state name), for the
 * sidebar's state dropdown. Mirrors getSourceIndex's single-windowed-query
 * approach. Categories for state feeds are "state:<ABBR>" (see
 * STATE_SOURCES in config/sources.js) — stateNames maps abbr -> full name
 * for display and alphabetical sorting.
 */
export async function getStateIndex(stateNames, { perStateLimit = 5 } = {}) {
  const { rows } = await pool.query(
    `SELECT category, title, url, published_at FROM (
       SELECT
         category, title, url, published_at,
         ROW_NUMBER() OVER (PARTITION BY category ORDER BY published_at DESC NULLS LAST) AS rn
       FROM articles
       WHERE category LIKE 'state:%'
     ) ranked
     WHERE rn <= $1`,
    [perStateLimit]
  );

  const byState = new Map();
  for (const row of rows) {
    const abbr = row.category.replace("state:", "");
    if (!byState.has(abbr)) byState.set(abbr, []);
    byState.get(abbr).push({ title: row.title, url: row.url });
  }

  return Array.from(byState.entries())
    .map(([abbr, articles]) => ({ abbr, name: stateNames.get(abbr) || abbr, articles }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
