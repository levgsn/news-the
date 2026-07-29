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
 * Same as getTrendingClusters, but pulls from several categories combined
 * and ranks across all of them together — used for the header hero strip
 * (currently U.S. Politics + World/Geopolitics + Crime/Legal combined).
 */
export async function getTrendingClustersMulti({ categories = [], limit = 10 } = {}) {
  if (categories.length === 0) return [];

  const { rows } = await pool.query(
    `SELECT
       c.id, c.representative_title, c.category, c.trending_score, c.last_seen_at,
       COUNT(DISTINCT a.source_name) AS source_count,
       (SELECT a2.url FROM articles a2 WHERE a2.cluster_id = c.id ORDER BY a2.published_at DESC NULLS LAST LIMIT 1) AS top_url,
       (SELECT a2.source_name FROM articles a2 WHERE a2.cluster_id = c.id ORDER BY a2.published_at DESC NULLS LAST LIMIT 1) AS top_source,
       (SELECT a2.image_url FROM articles a2 WHERE a2.cluster_id = c.id AND a2.image_url IS NOT NULL ORDER BY a2.published_at DESC NULLS LAST LIMIT 1) AS top_image
     FROM clusters c
     JOIN articles a ON a.cluster_id = c.id
     WHERE c.source_count >= 1 AND c.category = ANY($1::text[])
     GROUP BY c.id
     ORDER BY c.trending_score DESC
     LIMIT $2`,
    [categories, limit]
  );
  return rows;
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
