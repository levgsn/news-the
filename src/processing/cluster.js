import { pool } from "../db/client.js";
import { titleSimilarity } from "./similarity.js";

const WINDOW_HOURS = Number(process.env.CLUSTER_WINDOW_HOURS ?? 48);
const THRESHOLD = Number(process.env.CLUSTER_SIMILARITY_THRESHOLD ?? 0.35);

/**
 * Clusters every article that hasn't been assigned a cluster yet.
 *
 * IMPORTANT: this must run sequentially (one article at a time), not
 * concurrently. assignCluster() does a read-then-write (check candidates,
 * then insert-or-update) with no locking, so running it in parallel across
 * articles lets two near-simultaneous "same story, different outlet"
 * articles both miss each other as candidates and create duplicate
 * clusters instead of merging — this was caught in local testing with two
 * feeds publishing the same story worded differently at the same time.
 * Ingestion (fetchFeeds.js) is deliberately decoupled from clustering for
 * exactly this reason: fetch concurrently, cluster serially afterward.
 */
export async function clusterPendingArticles() {
  const { rows: pending } = await pool.query(
    `SELECT id, title, category FROM articles WHERE cluster_id IS NULL ORDER BY id ASC`
  );

  let clustered = 0;
  for (const article of pending) {
    const clusterId = await assignCluster(article);
    await pool.query(`UPDATE articles SET cluster_id = $1 WHERE id = $2`, [
      clusterId,
      article.id,
    ]);
    clustered++;
  }
  return clustered;
}

/**
 * Finds the best-matching open cluster for a given article, or creates a
 * new one. Candidate clusters are limited to the same category and a
 * recent time window so this stays fast even as the table grows.
 */
export async function assignCluster(article) {
  const { rows: candidates } = await pool.query(
    `SELECT id, representative_title, source_count
     FROM clusters
     WHERE category = $1
       AND last_seen_at > now() - ($2 || ' hours')::interval
     ORDER BY last_seen_at DESC
     LIMIT 300`,
    [article.category, WINDOW_HOURS]
  );

  let best = { id: null, score: 0 };
  for (const candidate of candidates) {
    const score = titleSimilarity(article.title, candidate.representative_title);
    if (score > best.score) {
      best = { id: candidate.id, score };
    }
  }

  if (best.id && best.score >= THRESHOLD) {
    await pool.query(
      `UPDATE clusters
       SET last_seen_at = now(), source_count = source_count + 1
       WHERE id = $1`,
      [best.id]
    );
    return best.id;
  }

  const { rows } = await pool.query(
    `INSERT INTO clusters (representative_title, category)
     VALUES ($1, $2)
     RETURNING id`,
    [article.title, article.category]
  );
  return rows[0].id;
}
