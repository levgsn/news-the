import express from "express";
import dotenv from "dotenv";
import {
  getTrendingClusters,
  getTrendingClustersPriority,
  getSourceIndex,
  getStateIndex,
} from "../ranking/trending.js";
import { getTodaysSong, getUpcomingSongs, setSongForDate, deleteSongForDate } from "../ranking/songSchedule.js";
import { CATEGORIES } from "../config/categories.js";
import { STATE_SOURCES } from "../config/sources.js";

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: false }));
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "";

// Fallback track when no song_schedule row exists for today. Spotify's
// OFFICIAL embed player for "Dreams Money Can Buy" by Drake
// (open.spotify.com/track/1qyFlfPREPbRcS2BNszdYI) — Spotify's own licensed
// widget; nothing is hosted or reproduced by this site.
const DEFAULT_SONG_TRACK_ID = "1qyFlfPREPbRcS2BNszdYI";

// Priority order for filling the 10 header hero slots: each tier's top
// trending stories fill as many slots as it has (up to what's left), then
// the next tier fills whatever's still open. `category: null` means "any
// category" — used here as an overall-trending catch-all above Crime/Legal.
const HERO_TIERS = [
  { category: "us_politics" },
  { category: "world_geopolitics" },
  { category: "business_economy" },
  { category: null },
  { category: "crime_legal" },
];

const STATE_NAMES = new Map(STATE_SOURCES.map((s) => [s.stateAbbr, s.stateName]));

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

function renderDropdownGroup(entries) {
  if (entries.length === 0) return `<p class="empty">Nothing here yet.</p>`;
  return entries
    .map((entry) => {
      const label = escapeHtml(entry.name);
      const links = entry.articles
        .map((a) => `<li><a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.title)}</a></li>`)
        .join("");
      return `<details class="source-entry">
        <summary>${label}</summary>
        <ul>${links}</ul>
      </details>`;
    })
    .join("\n");
}

function renderPage({ heroClusters, sourceIndex, stateIndex, categorySections, bigTrending, todaysSong }) {
  const categoriesHtml = categorySections
    .map(
      ({ label, clusters }) => `<section class="category-section">
        <h2>${escapeHtml(label)}</h2>
        ${renderHeadlineList(clusters)}
      </section>`
    )
    .join("\n");

  const trackId = todaysSong?.track_id || DEFAULT_SONG_TRACK_ID;

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
    align-items: center;
    flex-wrap: wrap;
    gap: 24px;
    border-bottom: 3px solid #000;
    padding-bottom: 12px;
    margin-bottom: 20px;
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
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
    flex: 1;
    min-width: 280px;
    max-width: 520px;
    margin-left: auto;
  }

  /* Glitch / chromatic-aberration logo, sized to fill the header's right side */
  .glitch {
    position: relative;
    font-family: 'Press Start 2P', monospace;
    font-size: clamp(20px, 3.6vw, 34px);
    line-height: 1.3;
    color: #2b0a4d;
    letter-spacing: 1px;
    text-align: right;
    width: 100%;
  }
  .glitch::before,
  .glitch::after {
    content: attr(data-text);
    position: absolute;
    top: 0;
    right: 0;
    width: 100%;
  }
  .glitch::before {
    color: #ff00e6;
    transform: translate(-3px, -2px);
    z-index: -1;
  }
  .glitch::after {
    color: #00e5ff;
    transform: translate(3px, 2px);
    z-index: -1;
  }

  .song-widget {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
  }
  .song-label {
    font-size: 11px;
    letter-spacing: 1px;
    color: var(--meta);
    text-transform: uppercase;
    font-family: Georgia, serif;
  }

  /* ---------- Section headers (shared look) ---------- */
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
    text-align: center;
  }

  /* ---------- Hero: 5 across, 2 down ---------- */
  .hero-trending { margin-bottom: 32px; }
  .hero-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 16px;
  }
  @media (max-width: 900px) {
    .hero-grid { grid-template-columns: repeat(2, 1fr); }
  }
  .hero-card { color: inherit; text-decoration: none; display: block; }
  .hero-thumb {
    width: 100%;
    aspect-ratio: 16 / 10;
    overflow: hidden;
    background: #eee;
    border: 1px solid #ccc;
  }
  .hero-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
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
  .hero-title { font-weight: bold; font-size: 13px; margin-top: 6px; color: var(--link); text-align: center; }
  .hero-meta { font-size: 11px; color: var(--meta); text-align: center; }

  /* ---------- Main layout: sidebar + categories, centered ---------- */
  .main-layout {
    display: flex;
    justify-content: center;
    gap: 30px;
    align-items: flex-start;
  }
  .sidebar { width: 240px; flex-shrink: 0; }
  .sidebar-group { margin-bottom: 22px; }
  .source-entry summary {
    cursor: pointer;
    font-weight: bold;
    font-size: 13px;
    padding: 4px 0;
    border-bottom: 1px solid #eee;
  }
  .source-entry ul { list-style: none; margin: 4px 0 8px 0; padding: 0 0 0 10px; }
  .source-entry li { font-size: 12px; margin-bottom: 4px; }
  .source-entry a { color: var(--link); text-decoration: none; }
  .source-entry a:hover { text-decoration: underline; }

  .categories {
    flex: 1;
    max-width: 760px;
    display: grid;
    grid-template-columns: repeat(2, minmax(280px, 1fr));
    gap: 20px;
    align-content: start;
    justify-content: center;
  }
  @media (max-width: 700px) {
    .categories { grid-template-columns: 1fr; }
  }
  .category-section {
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 14px 16px;
    background: #fafafa;
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

  .big-trending {
    margin-top: 40px;
    max-width: 800px;
    margin-left: auto;
    margin-right: auto;
  }
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
        <div class="song-label">Today's Song${todaysSong?.label ? ` &mdash; ${escapeHtml(todaysSong.label)}` : ""}</div>
        <iframe
          src="https://open.spotify.com/embed/track/${trackId}?utm_source=generator"
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
    <h2>U.S. Politics &middot; World / Geopolitics &middot; Crime &amp; Legal</h2>
    <div class="hero-grid">
      ${renderHeroCards(heroClusters)}
    </div>
  </section>

  <div class="main-layout">
    <aside class="sidebar">
      <div class="sidebar-group">
        <h3>All Sources (A&ndash;Z)</h3>
        ${renderDropdownGroup(sourceIndex)}
      </div>
      <div class="sidebar-group">
        <h3>By State (A&ndash;Z)</h3>
        ${renderDropdownGroup(stateIndex)}
      </div>
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
    const [heroClusters, sourceIndex, stateIndex, bigTrending, todaysSong, ...categoryClusters] = await Promise.all([
      getTrendingClustersPriority({ tiers: HERO_TIERS, limit: 10 }),
      getSourceIndex(),
      getStateIndex(STATE_NAMES),
      getTrendingClusters({ limit: 40 }),
      getTodaysSong(),
      ...CATEGORIES.map((cat) => getTrendingClusters({ category: cat.slug, limit: 10 })),
    ]);

    const categorySections = CATEGORIES.map((cat, i) => ({
      label: cat.label,
      clusters: categoryClusters[i],
    }));

    res.send(renderPage({ heroClusters, sourceIndex, stateIndex, categorySections, bigTrending, todaysSong }));
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

// --- Admin: song schedule ---------------------------------------------------
// Lightweight shared-secret gate (no login system) — set ADMIN_KEY in .env
// and visit /admin/song?key=YOUR_KEY. Good enough for a low-stakes internal
// tool; don't share the URL publicly.

function requireAdminKey(req, res, next) {
  if (!ADMIN_KEY || req.query.key !== ADMIN_KEY) {
    return res.status(403).send("Forbidden — missing or incorrect ?key=");
  }
  next();
}

app.get("/admin/song", requireAdminKey, async (req, res) => {
  const upcoming = await getUpcomingSongs();
  const rows = upcoming
    .map((s) => {
      const date = new Date(s.play_date).toISOString().slice(0, 10);
      return `<tr>
        <td>${escapeHtml(date)}</td>
        <td>${escapeHtml(s.track_id)}</td>
        <td>${escapeHtml(s.label || "")}</td>
        <td><form method="POST" action="/admin/song/delete?key=${escapeHtml(req.query.key)}" style="display:inline">
          <input type="hidden" name="play_date" value="${escapeHtml(date)}" />
          <button type="submit">Remove</button>
        </form></td>
      </tr>`;
    })
    .join("");

  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Song Schedule Admin</title>
    <style>
      body{font-family:Georgia,serif;max-width:700px;margin:40px auto;padding:0 20px;}
      table{width:100%;border-collapse:collapse;margin-top:20px;}
      td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left;font-size:14px;}
      input,button{font-size:14px;padding:6px;}
      form.add{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:16px;}
      label{font-size:12px;color:#555;display:block;}
    </style></head>
    <body>
      <h1>Today's Song &mdash; Schedule</h1>
      <p>Add or change the song for any future date. Find a track's ID in its
      Spotify URL: <code>open.spotify.com/track/&lt;THIS PART&gt;</code></p>
      <form class="add" method="POST" action="/admin/song?key=${escapeHtml(req.query.key)}">
        <div><label>Date</label><input type="date" name="play_date" required /></div>
        <div><label>Spotify Track ID</label><input type="text" name="track_id" required placeholder="e.g. 1qyFlfPREPbRcS2BNszdYI" size="30" /></div>
        <div><label>Label (optional)</label><input type="text" name="label" placeholder="Song &mdash; Artist" size="24" /></div>
        <button type="submit">Save</button>
      </form>
      <table>
        <thead><tr><th>Date</th><th>Track ID</th><th>Label</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4">No upcoming songs scheduled — today falls back to the default track.</td></tr>`}</tbody>
      </table>
    </body></html>`);
});

app.post("/admin/song", requireAdminKey, async (req, res) => {
  const { play_date, track_id, label } = req.body;
  if (!play_date || !track_id) return res.status(400).send("Missing play_date or track_id");
  await setSongForDate(play_date, track_id.trim(), (label || "").trim());
  res.redirect(`/admin/song?key=${encodeURIComponent(req.query.key)}`);
});

app.post("/admin/song/delete", requireAdminKey, async (req, res) => {
  const { play_date } = req.body;
  if (play_date) await deleteSongForDate(play_date);
  res.redirect(`/admin/song?key=${encodeURIComponent(req.query.key)}`);
});

app.listen(PORT, () => {
  console.log(`[server] NEWS, THE listening on port ${PORT}`);
});
