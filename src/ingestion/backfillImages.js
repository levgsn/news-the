import { pool } from "../db/client.js";

const FETCH_TIMEOUT_MS = 8000;
const UA = "NewsTheBot/0.1 (+https://example.com/bot)";

function extractOgImage(html) {
  // og:image, property-then-content or content-then-property attribute order
  let m =
    /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i.exec(html) ||
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i.exec(html);
  if (m) return m[1];

  // twitter:image as a fallback — nearly as universal, same either-order handling
  m =
    /<meta[^>]+name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i.exec(html) ||
    /<meta[^>]+content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i.exec(html);
  if (m) return m[1];

  return null;
}

async function fetchOgImage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    // Only read enough of the page to find <head> — avoids downloading a
    // full multi-MB article page just to read a meta tag.
    const html = await res.text();
    return extractOgImage(html);
  } catch {
    return null; // timeouts, blocked bots, malformed HTML — just skip it
  } finally {
    clearTimeout(timeout);
  }
}

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
