import Parser from "rss-parser";
import { pool } from "../db/client.js";
import { SOURCES } from "../config/sources.js";

const parser = new Parser({
  timeout: 15000,
  headers: { "User-Agent": "NewsTheBot/0.1 (+https://example.com/bot)" },
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: true }],
    ],
  },
});

/**
 * Pulls a thumbnail URL out of an RSS item, trying the common places outlets
 * put one, roughly in order of reliability. Returns null if nothing usable
 * is found — the UI falls back to a plain placeholder card in that case.
 */
function extractImage(item) {
  // 1. Standard <enclosure> with an image type (rss-parser parses this itself)
  if (item.enclosure?.url && (item.enclosure.type || "").startsWith("image")) {
    return item.enclosure.url;
  }

  // 2. Media RSS <media:content> (very common: BBC, Guardian, etc.)
  const mediaContent = item.mediaContent?.[0]?.$;
  if (mediaContent?.url && (!mediaContent.medium || mediaContent.medium === "image")) {
    return mediaContent.url;
  }

  // 3. Media RSS <media:thumbnail>
  const mediaThumb = item.mediaThumbnail?.[0]?.$;
  if (mediaThumb?.url) {
    return mediaThumb.url;
  }

  // 4. Some feeds only put an <img> tag inside the HTML description/content
  const html = item["content:encoded"] || item.content || item.contentSnippet || "";
  const match = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  if (match) return match[1];

  return null;
}

async function fetchOneSource(source) {
  let feed;
  try {
    feed = await parser.parseURL(source.url);
  } catch (err) {
    console.error(`[ingest] FAILED source="${source.name}": ${err.message}`);
    return { source: source.name, inserted: 0, failed: true };
  }

  let inserted = 0;

  for (const item of feed.items ?? []) {
    const title = (item.title || "").trim();
    const url = (item.link || "").trim();
    if (!title || !url) continue;

    const publishedAt = item.isoDate || item.pubDate || null;
    const imageUrl = extractImage(item);

    // ON CONFLICT (url) DO NOTHING makes this safe to re-run on overlapping
    // feed windows without creating duplicate articles. cluster_id is left
    // NULL here on purpose — clustering runs as a separate serial pass
    // (see clusterPendingArticles in processing/cluster.js) so that two
    // sources fetching concurrently can't race each other into creating
    // duplicate clusters for the same story.
    const { rows } = await pool.query(
      `INSERT INTO articles (source_name, category, title, url, published_at, image_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (url) DO NOTHING
       RETURNING id`,
      [source.name, source.category, title, url, publishedAt, imageUrl]
    );

    if (rows.length === 0) continue; // already existed
    inserted++;
  }

  return { source: source.name, inserted, failed: false };
}

/**
 * Runs ingestion across all configured sources. Sequential with a small
 * concurrency window rather than fully parallel, so we don't hammer 20
 * feeds at once from a single Railway worker.
 */
export async function fetchAllFeeds({ concurrency = 4 } = {}) {
  const results = [];
  const queue = [...SOURCES];

  async function worker() {
    while (queue.length > 0) {
      const source = queue.shift();
      const result = await fetchOneSource(source);
      results.push(result);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
