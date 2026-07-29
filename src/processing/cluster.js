import { pool } from "../db/client.js";
import { titleSimilarity } from "./similarity.js";

const WINDOW_HOURS = Number(process.env.CLUSTER_WINDOW_HOURS ?? 48);
const THRESHOLD = Number(process.env.CLUSTER_SIMILARITY_THRESHOLD ?? 0.35);

/**
 * Clusters every article that hasn't been assigned a cluster yet.
 *
 * Correctness note carried over from the original version: this must stay
 * a SEQUENTIAL loop, not concurrent per-article processing. Two
 * near-simultaneous "same story, different outlet" articles need to see
 * each other's cluster to merge instead of creating duplicates — this was
 * caught in local testing early on. Ingestion (fetchFeeds.js) stays
 * concurrent; clustering runs after it, one article at a time.
 *
 * Performance note: the original version ran one SELECT per pending
 * article to find candidate clusters. That's fine at a couple dozen feeds,
 * but becomes the main bottleneck once state feeds bring the total past
 * ~500 articles/run. This version loads every recent cluster ONCE up front
 * (one query, grouped by category in memory) and only hits the database
 * for writes (one UPDATE or INSERT per article, which is unavoidable —
 * each processed article really does need its own write). New clusters
 * created mid-run are added to the in-memory map immediately so later
 * articles in the same batch can still match against them.
 */
export async function clusterPendingArticles() {
  const clustersByCategory = await loadRecentClustersByCategory();

  const { rows: pending } = await pool.query(
    `SELECT id, title, category FROM articles WHERE cluster_id IS NULL ORDER BY id ASC`
  );

  let clustered = 0;
  for (const article of pending) {
    const candidates = clustersByCategory.get(article.category) || [];

    let best = { id: null, score: 0 };
    for (const candidate of candidates) {
      const score = titleSimilarity(article.title, candidate.representative_title);
      if (score > best.score) best = { id: candidate.id, score };
    }

    let clusterId;
    if (best.id && best.score >= THRESHOLD) {
      await pool.query(
        `UPDATE clusters SET last_seen_at = now(), source_count = source_count + 1 WHERE id = $1`,
        [best.id]
      );
      clusterId = best.id;
    } else {
      const { rows } = await pool.query(
        `INSERT INTO clusters (representative_title, category) VALUES ($1, $2) RETURNING id`,
        [article.title, article.category]
      );
      clusterId = rows[0].id;
      if (!clustersByCategory.has(article.category)) clustersByCategory.set(article.category, []);
      clustersByCategory.get(article.category).push({ id: clusterId, representative_title: article.title });
    }

    await pool.query(`UPDATE articles SET cluster_id = $1 WHERE id = $2`, [clusterId, article.id]);
    clustered++;
  }

  return clustered;
}

async function loadRecentClustersByCategory() {
  const { rows } = await pool.query(
    `SELECT id, category, representative_title
     FROM clusters
     WHERE last_seen_at > now() - ($1 || ' hours')::interval`,
    [WINDOW_HOURS]
  );

  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.category)) map.set(row.category, []);
    map.get(row.category).push({ id: row.id, representative_title: row.representative_title });
  }
  return map;
}
