const GNEWS_API_URL = "https://gnews.io/api/v4/search";

// GNews treats bare hyphens as query operators, so phrases like
// "anarcho-capitalism" come back as 400 syntax errors. Wrapping in quotes
// makes it a literal phrase search.
function sanitizeTerm(term) {
  return `"${term.replace(/"/g, "")}"`;
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
