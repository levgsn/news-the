import express from "express";
import dotenv from "dotenv";
import { getTrendingClusters, getSourceIndex } from "../ranking/trending.js";
import { CATEGORIES } from "../config/categories.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Spotify's OFFICIAL embed player for "Dreams Money Can Buy" by Drake
// (open.spotify.com/track/1qyFlfPREPbRcS2BNszdYI). This is Spotify's own
// licensed widget — it streams via Spotify's player, nothing is hosted or
// reproduced by this site.
const TODAYS_SONG_TRACK_ID = "1qyFlfPREPbRcS2BNszdYI";

// --- JSON API -----------------------------------------------------------

app.get("/api/trending", async (req, res) => {
  const category = req.query.category || null;
  const limit = Math.min(Number(req.query.limit) || 40, 100);
  try {
    const clusters = await getTrendingClusters({ category, limit });
    res.json({ count: clusters.length, clusters });
  } catch (err) {
    console.error("[api/trending] error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// --- HTML rendering helpers ----------------------------------------------

function escapeHtml(str = "") {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Deterministic pastel color per source name, used behind the placeholder
// thumbnail for articles that don't have a real image.
function placeholderColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 45%, 87%)`;
}

function renderHeadlineList(clusters) {
  if (clusters.length === 0) {
    return `<p class="empty">No stories yet in this section.</p>`;
  }
  return clusters
    .map((c) => {
      const title = escapeHtml(c.representative_title.toUpperCase());
      const url = escapeHtml(c.top_url || "#");
      const src = escapeHtml(c.top_source || "");
      const count = Number(c.source_count);
      return `<div class="headline">
        <a href="${url}" target="_blank" rel="noopener">${title}</a>
        <span class="meta">(${src}${count > 1 ? ` +${count - 1} more` : ""})</span>
      </div>`;
    })
    .join("\n");
}

function renderHeroCards(clusters) {
  if (clusters.length === 0) {
    return `<p class="empty">No trending stories yet — run <code>npm run ingest</code>.</p>`;
  }
  return clusters
    .map((c) => {
      const title = escapeHtml(c.representative_title);
      const url = escapeHtml(c.top_url || "#");
      const src = escapeHtml(c.top_source || "");
      const thumb = c.top_image
        ? `<img src="${escapeHtml(c.top_image)}" alt="" loading="lazy" />`
        : `<div class="thumb-placeholder" style="background:${placeholderColor(src)}"><span>${src}</span></div>`;
      return `<a class="hero-card" href="${url}" target="_blank" rel="noopener">
        <div class="hero-thumb">${thumb}</div>
        <div class="hero-title">${title}</div>
        <div class="hero-meta">${src}</div>
      </a>`;
    })
    .join("\n");
}

function renderSidebar(sourceIndex) {
  if (sourceIndex.length === 0) {
    return `<p class="empty">No sources yet.</p>`;
  }
  return sourceIndex
    .map((source) => {
      const name = escapeHtml(source.name);
      const links = source.articles
        .map((a) => `<li><a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.title)}</a></li>`)
        .join("");
      return `<details class="source-entry">
        <summary>${name}</summary>
        <ul>${links}</ul>
      </details>`;
    })
    .join("\n");
}

function renderPage({ heroClusters, sourceIndex, categorySections, bigTrending }) {
  const categoriesHtml = categorySections
    .map(
      ({ label, clusters }) => `<section class="category-section">
        <h2>${escapeHtml(label)}</h2>
        ${renderHeadlineList(clusters)}
      </section>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>NEWS, THE</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet" />
<style>
  :root {
    --ink: #000;
    --paper: #fff;
    --link: #0000cc;
    --visited: #551a8b;
    --meta: #666;
  }
  * { box-sizing: border-box; }
  body {
    background: var(--paper);
    color: var(--ink);
    font-family: Georgia, 'Times New Roman', serif;
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
    font-size: 16px;
    line-height: 1.5;
  }

  /* ---------- Header ---------- */
  .site-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: 20px;
    border-bottom: 3px solid #000;
    padding-bottom: 8px;
    margin-bottom: 16px;
  }
  .brand h1 {
    font-size: 28px;
    letter-spacing: 1px;
    margin: 0;
  }
  .brand .subtitle {
    font-size: 12px;
    color: var(--meta);
    text-transform: uppercase;
    margin-top: 2px;
  }
  .header-right {
    display: flex;
    align-items: center;
    gap: 24px;
    flex-wrap: wrap;
  }

  /* Glitch / chromatic-aberration logo text, styled after the reference image */
  .glitch {
    position: relative;
    font-family: 'Press Start 2P', monospace;
    font-size: 14px;
    line-height: 1.4;
    color: #2b0a4d;
    letter-spacing: 1px;
    white-space: nowrap;
  }
  .glitch::before,
  .glitch::after {
    content: attr(data-text);
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
  }
  .glitch::before {
    color: #ff00e6;
    transform: translate(-2px, -1px);
    z-index: -1;
  }
  .glitch::after {
    color: #00e5ff;
    transform: translate(2px, 1px);
    z-index: -1;
  }

  .song-widget {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .song-label {
    font-size: 11px;
    letter-spacing: 1px;
    color: var(--meta);
    text-transform: uppercase;
    font-family: Georgia, serif;
  }

  /* ---------- Hero / Top 10 ---------- */
  .hero-trending h2,
  .category-section h2,
  .big-trending h2,
  .sidebar h3 {
    font-size: 15px;
    letter-spacing: 1px;
    text-transform: uppercase;
    border-bottom: 2px solid #000;
    padding-bottom: 4px;
    margin: 0 0 10px 0;
  }
  .hero-trending {
    margin-bottom: 28px;
  }
  .hero-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 14px;
  }
  .hero-card {
    color: inherit;
    text-decoration: none;
    display: block;
  }
  .hero-thumb {
    width: 100%;
    aspect-ratio: 16 / 10;
    overflow: hidden;
    background: #eee;
    border: 1px solid #ccc;
  }
  .hero-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .thumb-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: bold;
    text-align: center;
    padding: 6px;
    color: #333;
  }
  .hero-title {
    font-weight: bold;
    font-size: 13px;
    margin-top: 6px;
    color: var(--link);
  }
  .hero-meta {
    font-size: 11px;
    color: var(--meta);
  }

  /* ---------- Main layout: sidebar + categories ---------- */
  .main-layout {
    display: flex;
    gap: 30px;
    align-items: flex-start;
  }
  .sidebar {
    width: 230px;
    flex-shrink: 0;
  }
  .source-entry summary {
    cursor: pointer;
    font-weight: bold;
    font-size: 13px;
    padding: 4px 0;
    border-bottom: 1px solid #eee;
  }
  .source-entry ul {
    list-style: none;
    margin: 4px 0 8px 0;
    padding: 0 0 0 10px;
  }
  .source-entry li {
    font-size: 12px;
    margin-bottom: 4px;
  }
  .source-entry a {
    color: var(--link);
    text-decoration: none;
  }
  .source-entry a:hover { text-decoration: underline; }

  .categories {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 24px;
    align-content: start;
  }

  /* ---------- Shared headline styling ---------- */
  .headline { margin-bottom: 10px; }
  .headline a {
    color: var(--link);
    font-weight: bold;
    text-decoration: none;
    font-size: 15px;
  }
  .headline a:visited { color: var(--visited); }
  .headline a:hover { text-decoration: underline; }
  .meta { color: var(--meta); font-size: 11px; margin-left: 6px; }
  .empty { color: var(--meta); font-size: 13px; }

  .big-trending { margin-top: 36px; }
</style>
</head>
<body>
  <header class="site-header">
    <div class="brand">
      <h1>NEWS, THE</h1>
      <div class="subtitle">Trending across ${heroClusters.length + bigTrending.length} stories &middot; refreshed continuously</div>
    </div>
    <div class="header-right">
      <div class="glitch" data-text="NEWS COMES FIRST">NEWS COMES FIRST</div>
      <div class="song-widget">
        <div class="song-label">Today's Song</div>
        <iframe
          src="https://open.spotify.com/embed/track/${TODAYS_SONG_TRACK_ID}?utm_source=generator"
          width="280"
          height="80"
          frameborder="0"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
        ></iframe>
      </div>
    </div>
  </header>

  <section class="hero-trending">
    <h2>Top 10 Trending</h2>
    <div class="hero-grid">
      ${renderHeroCards(heroClusters)}
    </div>
  </section>

  <div class="main-layout">
    <aside class="sidebar">
      <h3>All Sources (A&ndash;Z)</h3>
      ${renderSidebar(sourceIndex)}
    </aside>
    <main class="categories">
      ${categoriesHtml}
    </main>
  </div>

  <section class="big-trending">
    <h2>Trending Now</h2>
    ${renderHeadlineList(bigTrending)}
  </section>
</body>
</html>`;
}

// --- Routes ---------------------------------------------------------------

app.get("/", async (req, res) => {
  try {
    const [heroClusters, sourceIndex, bigTrending, ...categoryClusters] = await Promise.all([
      getTrendingClusters({ limit: 10 }),
      getSourceIndex(),
      getTrendingClusters({ limit: 40 }),
      ...CATEGORIES.map((cat) => getTrendingClusters({ category: cat.slug, limit: 10 })),
    ]);

    const categorySections = CATEGORIES.map((cat, i) => ({
      label: cat.label,
      clusters: categoryClusters[i],
    }));

    res.send(renderPage({ heroClusters, sourceIndex, categorySections, bigTrending }));
  } catch (err) {
    console.error("[/] error:", err);
    res.status(500).send("Something broke. Check server logs.");
  }
});

app.get("/section/:category", async (req, res) => {
  try {
    const clusters = await getTrendingClusters({ category: req.params.category, limit: 50 });
    const meta = CATEGORIES.find((c) => c.slug === req.params.category);
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>${escapeHtml(meta?.label || req.params.category)} — NEWS, THE</title>
      <style>body{font-family:Georgia,serif;max-width:900px;margin:0 auto;padding:20px;}
      .headline{margin-bottom:10px;} .headline a{color:#0000cc;font-weight:bold;text-decoration:none;font-size:16px;}
      .headline a:visited{color:#551a8b;} .meta{color:#666;font-size:12px;margin-left:6px;}</style></head>
      <body><h1>${escapeHtml(meta?.label || req.params.category)}</h1>${renderHeadlineList(clusters)}</body></html>`);
  } catch (err) {
    console.error("[/section] error:", err);
    res.status(500).send("Something broke. Check server logs.");
  }
});

app.listen(PORT, () => {
  console.log(`[server] NEWS, THE listening on port ${PORT}`);
});
