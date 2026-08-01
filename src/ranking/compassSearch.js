const GNEWS_API_URL = "https://gnews.io/api/v4/search";

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min -- keeps repeat clicks on the same cell fast/cheap and off the free-tier daily quota
const cache = new Map(); // cell.key -> { expiresAt, items }

// GNews treats bare hyphens as query operators, so terms like
// "anarcho-capitalism" or "right-libertarian" come back as 400 syntax
// errors. Wrapping the phrase in quotes makes it a literal phrase search.
function sanitizeTerm(term) {
  return `"${term.replace(/"/g, "")}"`;
}

export async function fetchGNews(term, max) {
  const apiKey = process.env.GNEWS_API_KEY;
  if (!apiKey) {
    console.error("[compassSearch] GNEWS_API_KEY not set");
    return [];
  }
  const url = `${GNEWS_API_URL}?q=${encodeURIComponent(sanitizeTerm(term))}&lang=en&max=${Math.min(max, 10)}&apikey=${apiKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GNews API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.articles ?? [];
  } catch (err) {
    console.error(`[compassSearch] FAILED term="${term}": ${err.message}`);
    return [];
  }
}

/**
 * Live web search for a compass grid cell, via the GNews.io API. Each
 * cell has multiple search terms (config/compassGrid.js's fallback pair,
 * or the AI-generated set from ai/compassQueries.js) -- this runs EVERY
 * term for the cell and merges the results into one fuller list, rather
 * than the single narrow query a cell used to get, which is what left
 * some cells (e.g. the green quadrant) with only one or two results
 * after the one-per-outlet dedup.
 *
 * Diversifies one story per outlet across the WHOLE merged set (not
 * per-term), same rule as the hero grid (getTrendingClustersPriority in
 * ranking/trending.js) -- so running 2-3 queries doesn't just mean 2-3x
 * the same outlets repeated.
 */
export async function searchNewsForCell(cell, terms, { limit = 12 } = {}) {
  const cached = cache.get(cell.key);
  if (cached && cached.expiresAt > Date.now()) return cached.items;

  const usedOutlets = new Set();
  const usedUrls = new Set();
  const picked = [];

  for (const term of terms) {
    if (picked.length >= limit) break;
    const articles = await fetchGNews(term, 10);

    for (const article of articles) {
      if (picked.length >= limit) break;
      if (!article.title || !article.url) continue;
      if (usedUrls.has(article.url)) continue;
      const outlet = article.source?.name || "Unknown";
      if (usedOutlets.has(outlet)) continue;

      usedOutlets.add(outlet);
      usedUrls.add(article.url);
      picked.push({
        title: article.title,
        url: article.url,
        outlet,
        publishedAt: article.publishedAt || null,
        image: article.image || null,
      });
    }
  }

  cache.set(cell.key, { expiresAt: Date.now() + CACHE_TTL_MS, items: picked });
  return picked;
}
