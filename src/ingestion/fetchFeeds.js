import Parser from "rss-parser";
import { pool } from "../db/client.js";
import { SOURCES, STATE_SOURCES } from "../config/sources.js";

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
 * is found — see backfillMissingImages() in trending.js's sibling module
 * for the og:image fallback that runs afterward for prominently-displayed
 * stories that still have nothing.
 */
function extractImage(item) {
  if (item.enclosure?.url && (item.enclosure.type || "").startsWith("image")) {
    return item.enclosure.url;
  }
  const mediaContent = item.mediaContent?.[0]?.$;
  if (mediaContent?.url && (!mediaContent.medium || mediaContent.medium === "image")) {
    return mediaContent.url;
  }
  const mediaThumb = item.mediaThumbnail?.[0]?.$;
  if (mediaThumb?.url) return mediaThumb.url;

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

  const rows = [];
  for (const item of feed.items ?? []) {
    const title = (item.title || "").trim();
    const url = (item.link || "").trim();
    if (!title || !url) continue;
    rows.push({
      source_name: source.name,
      category: source.category,
      title,
      url,
      published_at: item.isoDate || item.pubDate || null,
      image_url: extractImage(item),
    });
  }

  if (rows.length === 0) return { source: source.name, inserted: 0, failed: false };

  // Batched multi-row insert (one round trip for the whole feed) instead of
  // one INSERT per item — matters a lot once you're running 70+ feeds per
  // cycle instead of a handful. ON CONFLICT (url) DO NOTHING keeps re-runs
  // over overlapping feed windows safe.
  const { rows: inserted } = await pool.query(
    `INSERT INTO articles (source_name, category, title, url, published_at, image_url)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::timestamptz[], $6::text[])
     ON CONFLICT (url) DO NOTHING
     RETURNING id`,
    [
      rows.map((r) => r.source_name),
      rows.map((r) => r.category),
      rows.map((r) => r.title),
      rows.map((r) => r.url),
      rows.map((r) => r.published_at),
      rows.map((r) => r.image_url),
    ]
  );

  return { source: source.name, inserted: inserted.length, failed: false };
}

/**
 * Runs ingestion across all configured sources (national + all state feeds).
 * Sequential with a small concurrency window rather than fully parallel, so
 * we don't hammer 70+ feeds at once from a single Railway worker.
 */
export async function fetchAllFeeds({ concurrency = 6, includeStates = true } = {}) {
  const results = [];
  const queue = [...SOURCES, ...(includeStates ? STATE_SOURCES : [])];

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
