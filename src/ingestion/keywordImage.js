import { pool } from "../db/client.js";

const OPENVERSE_API = "https://api.openverse.org/v1/images/";
const UA = "DirectioNews/0.1 (+https://news-the-web-production.up.railway.app)";

// Words that carry no visual meaning -- searching them returns noise.
const STOPWORDS = new Set([
  "about", "after", "again", "against", "amid", "among", "another", "around", "because", "before",
  "being", "between", "could", "during", "first", "found", "friday", "から", "into", "monday",
  "more", "most", "over", "said", "says", "since", "some", "than", "that", "their", "them",
  "then", "there", "these", "they", "this", "those", "through", "under", "until", "what",
  "when", "where", "which", "while", "will", "with", "would", "your", "from", "have", "here",
  "just", "like", "make", "many", "much", "must", "near", "need", "news", "next", "only",
  "other", "should", "still", "take", "tell", "thursday", "tuesday", "wednesday", "week",
  "were", "years", "sunday", "saturday", "report", "reports", "amid", "back", "call", "calls",
  "case", "come", "down", "even", "goes", "good", "gets", "high", "keep", "know", "last",
  "left", "long", "look", "made", "off", "out", "put", "set", "top", "way", "new", "big",
]);

/**
 * Picks the most visually-searchable word from a headline: prefers
 * capitalised words (names, places, organisations), then the longest
 * remaining word. Returns null if nothing usable is left.
 */
export function extractKeyword(title = "") {
  const words = String(title)
    .replace(/[^\w\s'-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const capitalised = words.filter(
    (w) => /^[A-Z][a-z]{3,}$/.test(w) && !STOPWORDS.has(w.toLowerCase())
  );
  if (capitalised.length > 0) return capitalised[0].toLowerCase();

  const candidates = words
    .map((w) => w.toLowerCase().replace(/^['-]+|['-]+$/g, ""))
    .filter((w) => w.length > 4 && !STOPWORDS.has(w))
    .sort((a, b) => b.length - a.length);

  return candidates[0] || null;
}

async function searchOpenverse(keyword) {
  const url = `${OPENVERSE_API}?q=${encodeURIComponent(keyword)}&page_size=3&license_type=all&mature=false`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const hit = (data.results || []).find((r) => r.url);
    if (!hit) return null;
    return {
      image_url: hit.url,
      source_url: hit.foreign_landing_url || null,
      license: hit.license || null,
      creator: hit.creator || null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Illustrative image for a keyword, from Openverse's CC-licensed pool.
 * Cached permanently per keyword -- including negative results (a row
 * with a NULL image_url), so a keyword that finds nothing isn't retried
 * on every ingest.
 */
export async function getKeywordImage(keyword) {
  if (!keyword) return null;

  const { rows } = await pool.query(`SELECT image_url, license, creator FROM keyword_images WHERE keyword = $1`, [keyword]);
  if (rows.length > 0) return rows[0].image_url ? rows[0] : null;

  const found = await searchOpenverse(keyword);
  await pool.query(
    `INSERT INTO keyword_images (keyword, image_url, source_url, license, creator)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (keyword) DO NOTHING`,
    [keyword, found?.image_url || null, found?.source_url || null, found?.license || null, found?.creator || null]
  );
  return found;
}

/**
 * Last-resort thumbnail pass: for clusters STILL without artwork after
 * the publisher og:image scrape, find a CC-licensed image matching a
 * keyword from the headline. These are flagged image_is_stock so the UI
 * can label them -- a generic photo of "wildfire" next to a specific
 * wildfire story would otherwise read as documentary evidence of that
 * event, which it isn't.
 */
export async function backfillKeywordImages(clusters, { concurrency = 6 } = {}) {
  const targets = clusters.filter((c) => c && !c.top_image && c.representative_title);
  if (targets.length === 0) return { checked: 0, filled: 0 };

  const queue = [...targets];
  let filled = 0;

  async function worker() {
    while (queue.length > 0) {
      const cluster = queue.shift();
      const keyword = extractKeyword(cluster.representative_title);
      if (!keyword) continue;
      const image = await getKeywordImage(keyword);
      if (!image?.image_url) continue;

      // Attach to the cluster's newest article so the existing top_image
      // subquery picks it up on subsequent page loads.
      await pool.query(
        `UPDATE articles SET image_url = $1, image_is_stock = true
         WHERE id = (
           SELECT id FROM articles WHERE cluster_id = $2
           ORDER BY published_at DESC NULLS LAST LIMIT 1
         )`,
        [image.image_url, cluster.id]
      );
      cluster.top_image = image.image_url;
      cluster.top_image_is_stock = true;
      filled++;
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return { checked: targets.length, filled };
}
