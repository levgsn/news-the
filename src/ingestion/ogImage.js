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

export async function fetchOgImage(url) {
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
    return extractOgImage(html);
  } catch {
    return null; // timeouts, blocked bots, malformed HTML — just skip it
  } finally {
    clearTimeout(timeout);
  }
}
