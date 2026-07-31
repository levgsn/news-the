import Parser from "rss-parser";
import { googleNewsFeed } from "../config/sources.js";

const parser = new Parser({
  timeout: 15000,
  headers: { "User-Agent": "NewsTheBot/0.1 (+https://example.com/bot)" },
});

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min -- keeps repeat clicks on the same zone fast/cheap
const cache = new Map(); // zone label -> { expiresAt, items }

// Google News RSS item titles are formatted "HEADLINE - Outlet Name" --
// this is the only place a per-item outlet name is available (the feed
// itself is one query across many outlets, unlike the curated single-outlet
// feeds in config/sources.js).
function splitTitleAndOutlet(rawTitle) {
  const idx = rawTitle.lastIndexOf(" - ");
  if (idx === -1) return { title: rawTitle, outlet: "Unknown" };
  return { title: rawTitle.slice(0, idx), outlet: rawTitle.slice(idx + 3) };
}

/**
 * Live web search for news matching a compass zone's label, e.g.
 * "Activism" or "Anarcho-Capitalism" -- this is a real-time Google News
 * query (same technique already used for Crime/Legal, Climate/Disasters,
 * etc. in config/sources.js), not a filter over already-ingested articles.
 *
 * Diversifies one story per outlet, same rule as the hero grid
 * (getTrendingClustersPriority in ranking/trending.js) -- take results in
 * the feed's own relevance order, skip an outlet once it's already used.
 *
 * No thumbnail scraping here (deliberately): every `link` Google News RSS
 * hands back is one of its own proprietary redirect tokens
 * (news.google.com/rss/articles/...), not the real article URL -- Google
 * resolves those client-side via JS, so a server-side fetch just downloads
 * Google's own News app shell and its og:image is Google's icon, not the
 * article's. That's actively misleading, not merely missing, so items are
 * returned with image: null and the renderer's honest outlet-colored
 * placeholder is used instead. (Decoding Google's internal redirect
 * format would mean reverse-engineering an undocumented private API --
 * not something to build a real feature on top of.)
 */
export async function searchNewsForZone(zone, { limit = 12 } = {}) {
  const cached = cache.get(zone.label);
  if (cached && cached.expiresAt > Date.now()) return cached.items;

  let feed;
  try {
    feed = await parser.parseURL(googleNewsFeed(zone.query || zone.label));
  } catch (err) {
    console.error(`[compassSearch] FAILED zone="${zone.label}": ${err.message}`);
    return [];
  }

  const usedOutlets = new Set();
  const picked = [];
  for (const item of feed.items ?? []) {
    if (picked.length >= limit) break;
    const rawTitle = (item.title || "").trim();
    const url = (item.link || "").trim();
    if (!rawTitle || !url) continue;

    const { title, outlet } = splitTitleAndOutlet(rawTitle);
    if (usedOutlets.has(outlet)) continue;

    usedOutlets.add(outlet);
    picked.push({ title, url, outlet, publishedAt: item.isoDate || item.pubDate || null, image: null });
  }

  cache.set(zone.label, { expiresAt: Date.now() + CACHE_TTL_MS, items: picked });
  return picked;
}
