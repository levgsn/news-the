import Parser from "rss-parser";
import { NEWS_SITES } from "../config/newsSites.js";

const parser = new Parser({
  timeout: 12000,
  headers: { "User-Agent": "Mozilla/5.0 (compatible; DirectioNewsBot/1.0)" },
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: true }],
    ],
  },
});

// Fetched on click rather than on page load -- loading 60 feeds up front
// would make the page crawl, and most readers open one or two. Cached so
// flicking back and forth between outlets is instant.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // site id -> { expiresAt, items }

export const SITE_BY_ID = new Map(NEWS_SITES.map((s) => [s.id, s]));

function extractImage(item) {
  if (item.enclosure?.url && (item.enclosure.type || "").startsWith("image")) return item.enclosure.url;
  const mc = item.mediaContent?.[0]?.$;
  if (mc?.url && (!mc.medium || mc.medium === "image")) return mc.url;
  const mt = item.mediaThumbnail?.[0]?.$;
  if (mt?.url) return mt.url;
  const html = item["content:encoded"] || item.content || item.contentSnippet || "";
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  return m ? m[1] : null;
}

export async function getSiteArticles(siteId, { limit = 24 } = {}) {
  const site = SITE_BY_ID.get(siteId);
  if (!site) return null;

  const hit = cache.get(siteId);
  if (hit && hit.expiresAt > Date.now()) return { site, items: hit.items };

  let feed;
  try {
    feed = await parser.parseURL(site.rss);
  } catch (err) {
    console.error(`[siteFeed] ${siteId} failed: ${err.message}`);
    return { site, items: [], error: "This outlet's feed could not be reached just now." };
  }

  const items = (feed.items || [])
    .filter((i) => i.title && i.link)
    .slice(0, limit)
    .map((i) => ({
      title: i.title.trim(),
      url: i.link.trim(),
      publishedAt: i.isoDate || i.pubDate || null,
      image: extractImage(i),
      snippet: (i.contentSnippet || "").replace(/\s+/g, " ").trim().slice(0, 180),
    }));

  cache.set(siteId, { expiresAt: Date.now() + CACHE_TTL_MS, items });
  return { site, items };
}
