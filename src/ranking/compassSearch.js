const GNEWS_API_URL = "https://gnews.io/api/v4/search";

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min -- keeps repeat clicks on the same zone fast/cheap and off the free-tier daily quota
const cache = new Map(); // zone label -> { expiresAt, items }

/**
 * Live web search for news matching a compass zone's label, e.g.
 * "Activism" or "Anarcho-Capitalism", via the GNews.io API -- a real-time
 * search, not a filter over already-ingested articles. Unlike Google News
 * RSS (used elsewhere in this app for whole-category feeds), GNews hands
 * back the real article URL and a real thumbnail image directly, so no
 * og:image scraping is needed here.
 *
 * Diversifies one story per outlet, same rule as the hero grid
 * (getTrendingClustersPriority in ranking/trending.js) -- take results in
 * the API's own relevance order, skip an outlet once it's already used.
 */
export async function searchNewsForZone(zone, { limit = 10 } = {}) {
  const cached = cache.get(zone.label);
  if (cached && cached.expiresAt > Date.now()) return cached.items;

  const apiKey = process.env.GNEWS_API_KEY;
  if (!apiKey) {
    console.error("[compassSearch] GNEWS_API_KEY not set");
    return [];
  }

  const query = zone.query || zone.label;
  // Free-tier GNews caps `max` at 10 results per request.
  const url = `${GNEWS_API_URL}?q=${encodeURIComponent(query)}&lang=en&max=${Math.min(limit, 10)}&apikey=${apiKey}`;

  let data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GNews API ${res.status}: ${await res.text()}`);
    data = await res.json();
  } catch (err) {
    console.error(`[compassSearch] FAILED zone="${zone.label}": ${err.message}`);
    return [];
  }

  const usedOutlets = new Set();
  const picked = [];
  for (const article of data.articles ?? []) {
    if (picked.length >= limit) break;
    if (!article.title || !article.url) continue;
    const outlet = article.source?.name || "Unknown";
    if (usedOutlets.has(outlet)) continue;

    usedOutlets.add(outlet);
    picked.push({
      title: article.title,
      url: article.url,
      outlet,
      publishedAt: article.publishedAt || null,
      image: article.image || null,
    });
  }

  cache.set(zone.label, { expiresAt: Date.now() + CACHE_TTL_MS, items: picked });
  return picked;
}
