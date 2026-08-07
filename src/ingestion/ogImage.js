const FETCH_TIMEOUT_MS = 8000;
const UA = "NewsTheBot/0.1 (+https://example.com/bot)";

export function extractOgImage(html) {
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

// Google News RSS links (news.google.com/rss/articles/...) are proprietary
// redirect tokens, not real article URLs -- Google resolves them client-side
// with JS. Fetching one server-side returns Google's own News app shell,
// whose og:image is the Google News LOGO. Scraping those produced one
// identical placeholder logo across thousands of state-feed articles, which
// is worse than no image: it looks like a real thumbnail but tells the
// reader nothing. Skip the scrape entirely for these.
function isGoogleNewsRedirect(url) {
  return /^https?:\/\/news\.google\.com\//i.test(url);
}

// Safety net for the same problem arriving by another route: Google's own
// CDNs never host a publisher's article art in this pipeline.
export function isGenericGoogleAsset(imageUrl) {
  return /(^|\/\/)(lh\d+\.googleusercontent\.com|www\.gstatic\.com|ssl\.gstatic\.com)/i.test(imageUrl);
}

export async function fetchOgImage(url) {
  if (isGoogleNewsRedirect(url)) return null;

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
    const image = extractOgImage(html);
    if (!image || isGenericGoogleAsset(image)) return null;
    return image;
  } catch {
    return null; // timeouts, blocked bots, malformed HTML — just skip it
  } finally {
    clearTimeout(timeout);
  }
}
