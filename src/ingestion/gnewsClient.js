const GNEWS_API_URL = "https://gnews.io/api/v4/search";

// GNews treats hyphens and a few other characters as query operators, so
// raw terms like "anarcho-capitalism" return 400 syntax errors. Strip
// those to spaces.
//
// Do NOT wrap the result in quotes: that makes it an EXACT-PHRASE search,
// which is almost always zero results for a multi-word event query
// (e.g. "Jackson punching incident 1988" matched nothing). Unquoted,
// GNews ANDs the words, which is what finding coverage of a story needs.
function sanitizeTerm(term) {
  return term
    .replace(/["()]/g, " ")
    .replace(/(^|\s)[-+]|[-+](?=\s|$)/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Thin GNews.io search client (free tier: 100 requests/day, ~12h article
 * delay). Returns the raw articles array, [] on any failure -- callers
 * treat GNews as best-effort and never crash on it.
 */
export async function fetchGNews(term, max = 10) {
  const apiKey = process.env.GNEWS_API_KEY;
  if (!apiKey) {
    console.error("[gnews] GNEWS_API_KEY not set");
    return [];
  }
  const url = `${GNEWS_API_URL}?q=${encodeURIComponent(sanitizeTerm(term))}&lang=en&max=${Math.min(max, 10)}&apikey=${apiKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GNews API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.articles ?? [];
  } catch (err) {
    console.error(`[gnews] FAILED term="${term}": ${err.message}`);
    return [];
  }
}
