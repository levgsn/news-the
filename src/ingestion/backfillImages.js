import { pool } from "../db/client.js";
import { fetchOgImage } from "./ogImage.js";

/**
 * Finds clusters likely to be shown prominently (highest trending_score)
 * that have no image on any of their articles yet, and tries to backfill
 * one by scraping the top article's og:image tag. This is what fixes
 * outlets like Variety/Deadline whose RSS feeds don't include images at
 * all — the article page itself almost always has an Open Graph image
 * even when the feed doesn't.
 */
export async function backfillMissingImages({ limit = 150, concurrency = 8 } = {}) {
  const { rows: candidates } = await pool.query(
    `SELECT
       c.id AS cluster_id,
       (SELECT a.id FROM articles a WHERE a.cluster_id = c.id ORDER BY a.published_at DESC NULLS LAST LIMIT 1) AS article_id,
       (SELECT a.url FROM articles a WHERE a.cluster_id = c.id ORDER BY a.published_at DESC NULLS LAST LIMIT 1) AS top_url
     FROM clusters c
     WHERE NOT EXISTS (
       SELECT 1 FROM articles a2 WHERE a2.cluster_id = c.id AND a2.image_url IS NOT NULL
     )
     ORDER BY c.trending_score DESC
     LIMIT $1`,
    [limit]
  );

  const queue = candidates.filter((c) => c.top_url);
  let filled = 0;

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      const image = await fetchOgImage(item.top_url);
      if (image) {
        await pool.query(`UPDATE articles SET image_url = $1 WHERE id = $2`, [image, item.article_id]);
        filled++;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return { checked: candidates.length, filled };
}
