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

/**
 * Same idea as backfillMissingImages, but scoped to a specific already-
 * fetched array of cluster rows (e.g. the 10 hero clusters for this page
 * load) instead of a DB-wide sweep -- called live from the "/" route so
 * the front page's hero thumbnails don't depend on when `npm run ingest`
 * last ran. Mutates each cluster row's `top_image` in place on success, so
 * the caller's already-fetched array reflects the fix immediately with no
 * extra query. Cheap after the first hit: the image_url is persisted, so
 * only genuinely new hero stories ever pay the live-fetch cost again.
 */
export async function backfillImagesForClusters(clusters, { concurrency = 10 } = {}) {
  const toFetch = clusters.filter((c) => !c.top_image && c.top_url);
  if (toFetch.length === 0) return { checked: 0, filled: 0 };

  const queue = [...toFetch];
  let filled = 0;

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      const image = await fetchOgImage(item.top_url);
      if (image) {
        await pool.query(`UPDATE articles SET image_url = $1 WHERE url = $2`, [image, item.top_url]);
        item.top_image = image;
        filled++;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, toFetch.length) }, worker));
  return { checked: toFetch.length, filled };
}
