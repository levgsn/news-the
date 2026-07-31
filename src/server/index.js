import express from "express";
import dotenv from "dotenv";
import {
  getTrendingClusters,
  getTrendingClustersPriority,
} from "../ranking/trending.js";
import { getTodaysSong, getUpcomingSongs, setSongForDate, deleteSongForDate } from "../ranking/songSchedule.js";
import { searchClusters } from "../ranking/search.js";
import { searchNewsForZone } from "../ranking/compassSearch.js";
import { getOrGenerateClusterSummary, getOrGenerateDailyRundown } from "../ai/summaries.js";
import { getOrSynthesizeAudio } from "../ai/audioCache.js";
import { CATEGORIES } from "../config/categories.js";
import { COMPASS_ZONES, findZoneForPoint } from "../config/compassZones.js";

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

const RUNDOWN_SCOPES = [
  { value: "all", label: "All" },
  { value: "authoritarian_left", label: "Auth-Left" },
  { value: "authoritarian_right", label: "Auth-Right" },
  { value: "libertarian_left", label: "Lib-Left" },
  { value: "libertarian_right", label: "Lib-Right" },
];
const RUNDOWN_SCOPE_VALUES = new Set(RUNDOWN_SCOPES.map((s) => s.value));

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

// Shared per-story "Summarize" + read-aloud controls, used by both the hero
// cards and the category headline lists. Text summary is fetched on
// button click; the play button only appears once a summary exists, and
// audio is only synthesized when THAT'S clicked too — nothing here calls
// Claude or ElevenLabs just because a card was rendered.
function renderSummaryControls(clusterId) {
  return `<div class="summary-controls">
    <button class="summarize-btn" type="button" data-cluster-id="${clusterId}" onclick="loadSummary(this)">Summarize</button>
    <div class="summary-text" id="summary-${clusterId}"></div>
    <button class="play-btn" type="button" data-cluster-id="${clusterId}" style="display:none" onclick="playSummaryAudio(this)">&#128266; Listen</button>
  </div>`;
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
        ${renderSummaryControls(c.id)}
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
      return `<div class="hero-card">
        <a class="hero-card-link" href="${url}" target="_blank" rel="noopener">
          <div class="hero-thumb">${thumb}</div>
          <div class="hero-title">${title}</div>
          <div class="hero-meta">${src}</div>
        </a>
        ${renderSummaryControls(c.id)}
      </div>`;
    })
    .join("\n");
}

// Positions every labeled region from COMPASS_ZONES as an absolutely-placed
// box over the compass square, driven by the same data used server-side to
// resolve a click into a zone (config/compassZones.js) -- one source of
// truth for both the visual layout and the hit-testing.
function renderCompassZoneLabels() {
  return COMPASS_ZONES.map((z) => {
    const left = ((z.xMin + 1) / 2) * 100;
    const width = ((z.xMax - z.xMin) / 2) * 100;
    const top = ((1 - z.yMax) / 2) * 100;
    const height = ((z.yMax - z.yMin) / 2) * 100;
    return `<div class="compass-zone-label" style="left:${left}%;top:${top}%;width:${width}%;height:${height}%"><span>${escapeHtml(z.label)}</span></div>`;
  }).join("\n");
}

// Live web-search results (compassSearch.js) rendered as thumbnail cards,
// same visual language as the hero grid. These aren't DB clusters, so no
// summarize/audio controls -- just image + title + outlet, linking out.
function renderCompassResultCards(zoneLabel, items) {
  const heading = `<h3 class="compass-results-heading">${escapeHtml(zoneLabel)}</h3>`;
  if (items.length === 0) {
    return `${heading}<p class="empty">No live results found for this spot yet — try another point on the chart.</p>`;
  }
  const cards = items
    .map((item) => {
      const title = escapeHtml(item.title);
      const url = escapeHtml(item.url);
      const outlet = escapeHtml(item.outlet);
      const thumb = item.image
        ? `<img src="${escapeHtml(item.image)}" alt="" loading="lazy" />`
        : `<div class="thumb-placeholder" style="background:${placeholderColor(outlet)}"><span>${outlet}</span></div>`;
      return `<a class="compass-result-card" href="${url}" target="_blank" rel="noopener">
        <div class="compass-result-thumb">${thumb}</div>
        <div class="compass-result-title">${title}</div>
        <div class="compass-result-meta">${outlet}</div>
      </a>`;
    })
    .join("\n");
  return `${heading}<div class="compass-result-grid">${cards}</div>`;
}

function renderPage({ heroClusters, categorySections, bigTrending, todaysSong }) {
  const categoriesHtml = categorySections
    .map(
      ({ label, clusters }) => `<section class="category-section">
        <h2>${escapeHtml(label)}</h2>
        ${renderHeadlineList(clusters)}
      </section>`
    )
    .join("\n");

  const trackId = todaysSong?.track_id || DEFAULT_SONG_TRACK_ID;

  const rundownTabsHtml = RUNDOWN_SCOPES.map(
    (s, i) =>
      `<button type="button" class="rundown-tab${i === 0 ? " active" : ""}" data-scope="${s.value}" onclick="loadRundown('${s.value}', this)">${escapeHtml(s.label)}</button>`
  ).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>DirectioNews</title>
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

  /* ---------- Search bar ---------- */
  .search-row {
    display: flex;
    justify-content: center;
    margin-bottom: 28px;
  }
  .search-bar {
    display: flex;
    gap: 8px;
    width: 100%;
    max-width: 480px;
  }
  .search-bar input[type="text"] {
    flex: 1;
    font-family: Georgia, serif;
    font-size: 14px;
    padding: 8px 10px;
    border: 1px solid #999;
    border-radius: 4px;
  }
  .search-bar button {
    font-family: Georgia, serif;
    font-size: 14px;
    padding: 8px 14px;
    border: 1px solid #000;
    background: #000;
    color: #fff;
    border-radius: 4px;
    cursor: pointer;
  }
  .search-bar button:hover { background: #333; }

  /* ---------- Section headers (shared look) ---------- */
  .hero-trending h2,
  .category-section h2,
  .big-trending h2,
  .compass-widget h2,
  .rundown-widget h2 {
    font-size: 15px;
    letter-spacing: 1px;
    text-transform: uppercase;
    border-bottom: 2px solid #000;
    padding-bottom: 4px;
    margin: 0 0 10px 0;
    text-align: center;
  }

  /* ---------- Daily rundown ---------- */
  .rundown-widget {
    margin-bottom: 32px;
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 16px;
    background: #fafafa;
  }
  .rundown-tabs {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 14px;
  }
  .rundown-tab {
    font-family: Georgia, serif;
    font-size: 13px;
    padding: 6px 12px;
    border: 1px solid #999;
    background: #fff;
    border-radius: 4px;
    cursor: pointer;
  }
  .rundown-tab.active { background: #000; color: #fff; border-color: #000; }
  .rundown-text {
    max-width: 720px;
    margin: 0 auto;
    font-size: 15px;
    white-space: pre-wrap;
  }
  .rundown-play-btn {
    display: block;
    margin: 14px auto 0;
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
  .hero-card { display: flex; flex-direction: column; }
  .hero-card-link { color: inherit; text-decoration: none; display: block; }
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

  /* ---------- Per-story summary/audio controls ---------- */
  .summary-controls { margin-top: 6px; }
  .summarize-btn, .play-btn {
    font-family: Georgia, serif;
    font-size: 11px;
    padding: 3px 8px;
    border: 1px solid #999;
    background: #fff;
    border-radius: 3px;
    cursor: pointer;
  }
  .hero-card .summary-controls { text-align: center; }
  .summarize-btn:hover, .play-btn:hover { background: #eee; }
  .summarize-btn:disabled { opacity: 0.6; cursor: default; }
  .summary-text { font-size: 12px; color: #333; margin: 6px 0; line-height: 1.4; }

  /* ---------- Political compass ---------- */
  .compass-widget { margin-bottom: 36px; }
  .compass-hint { text-align: center; font-size: 12px; color: var(--meta); margin: 0 0 16px 0; }
  .compass-layout {
    display: flex;
    gap: 24px;
    flex-wrap: wrap;
    justify-content: center;
    align-items: flex-start;
  }
  .compass-square {
    position: relative;
    width: 520px;
    height: 520px;
    max-width: 100%;
    border: 2px solid #000;
    flex-shrink: 0;
    touch-action: none;
    cursor: crosshair;
  }
  .compass-quadrant { position: absolute; width: 50%; height: 50%; }
  .compass-q-al { top: 0; left: 0; background: #f6b8b8; }
  .compass-q-ar { top: 0; right: 0; background: #8fd0f0; }
  .compass-q-ll { bottom: 0; left: 0; background: #bfe3b6; }
  .compass-q-lr { bottom: 0; right: 0; background: #f2ee9e; }
  .compass-zone-label {
    position: absolute;
    box-sizing: border-box;
    border: 1px solid rgba(0, 0, 0, 0.18);
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 2px;
    pointer-events: none;
    overflow: hidden;
  }
  .compass-zone-label span {
    font-size: 9px;
    font-weight: bold;
    line-height: 1.1;
    color: #1a1a1a;
    text-shadow: 0 0 3px rgba(255, 255, 255, 0.7);
  }
  .compass-axis-label {
    position: absolute;
    font-size: 11px;
    font-weight: bold;
    color: #000;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    pointer-events: none;
  }
  .compass-top { top: -20px; left: 50%; transform: translateX(-50%); }
  .compass-bottom { bottom: -20px; left: 50%; transform: translateX(-50%); }
  .compass-left { top: 50%; left: -8px; transform: translate(-100%, -50%); text-align: right; }
  .compass-right { top: 50%; right: -8px; transform: translate(100%, -50%); text-align: left; }
  .compass-marker {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 18px;
    height: 18px;
    margin: -9px 0 0 -9px;
    background: #000;
    border: 2px solid #fff;
    border-radius: 50%;
    pointer-events: none;
    box-shadow: 0 0 0 1px #000;
    z-index: 10;
  }
  .compass-results {
    flex: 1;
    min-width: 280px;
    max-width: 560px;
  }
  .compass-results-heading {
    font-size: 14px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    border-bottom: 2px solid #000;
    padding-bottom: 4px;
    margin: 0 0 12px 0;
  }
  .compass-result-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  @media (max-width: 520px) {
    .compass-result-grid { grid-template-columns: repeat(2, 1fr); }
  }
  .compass-result-card { color: inherit; text-decoration: none; display: block; }
  .compass-result-thumb {
    width: 100%;
    aspect-ratio: 16 / 10;
    overflow: hidden;
    background: #eee;
    border: 1px solid #ccc;
  }
  .compass-result-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .compass-result-title { font-weight: bold; font-size: 11px; margin-top: 4px; color: var(--link); }
  .compass-result-meta { font-size: 10px; color: var(--meta); }

  /* ---------- Main layout: categories, centered ---------- */
  .main-layout {
    display: flex;
    justify-content: center;
    gap: 30px;
    align-items: flex-start;
  }
  .categories {
    flex: 1;
    max-width: 960px;
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
  .headline { margin-bottom: 14px; }
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
      <h1>DirectioNews</h1>
      <div class="subtitle">Trending across ${heroClusters.length + bigTrending.length} stories &middot; refreshed continuously</div>
    </div>
    <div class="header-right">
      <div class="glitch" data-text="Direct Your News">Direct Your News</div>
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

  <div class="search-row">
    <form class="search-bar" action="/search" method="GET">
      <input type="text" name="q" placeholder="Search headlines or sources..." autocomplete="off" />
      <button type="submit">Search</button>
    </form>
  </div>

  <section class="rundown-widget">
    <h2>Daily Rundown</h2>
    <div class="rundown-tabs">
      ${rundownTabsHtml}
    </div>
    <div class="rundown-text" id="rundownText"><p class="empty">Pick a scope above to generate today's rundown.</p></div>
    <button type="button" class="play-btn rundown-play-btn" id="rundownPlayBtn" style="display:none" onclick="playRundownAudio()">&#128266; Listen</button>
  </section>

  <section class="hero-trending">
    <h2>U.S. Politics &middot; World / Geopolitics &middot; Crime &amp; Legal</h2>
    <div class="hero-grid">
      ${renderHeroCards(heroClusters)}
    </div>
  </section>

  <section class="compass-widget">
    <h2>Curate By Political Lean</h2>
    <p class="compass-hint">Click or drag anywhere on the chart below — we'll search the web live for news matching that spot.</p>
    <div class="compass-layout">
      <div class="compass-square" id="compassSquare">
        <div class="compass-quadrant compass-q-al"></div>
        <div class="compass-quadrant compass-q-ar"></div>
        <div class="compass-quadrant compass-q-ll"></div>
        <div class="compass-quadrant compass-q-lr"></div>
        ${renderCompassZoneLabels()}
        <div class="compass-axis-label compass-top">Authoritarian</div>
        <div class="compass-axis-label compass-bottom">Libertarian</div>
        <div class="compass-axis-label compass-left">Econ.<br/>Left</div>
        <div class="compass-axis-label compass-right">Econ.<br/>Right</div>
        <div class="compass-marker" id="compassMarker"></div>
      </div>
      <div class="compass-results" id="compassResults">
        <p class="empty">Click the chart to see live curated stories.</p>
      </div>
    </div>
  </section>

  <div class="main-layout">
    <main class="categories">
      ${categoriesHtml}
    </main>
  </div>

  <section class="big-trending">
    <h2>Trending Now</h2>
    ${renderHeadlineList(bigTrending)}
  </section>

  <script>
    async function loadSummary(btn) {
      const id = btn.dataset.clusterId;
      btn.disabled = true;
      btn.textContent = "Loading...";
      try {
        const res = await fetch("/api/summary/" + id);
        const data = await res.json();
        document.getElementById("summary-" + id).textContent = data.summary || "No summary available.";
        if (data.summary) {
          btn.style.display = "none";
          const playBtn = document.querySelector('.play-btn[data-cluster-id="' + id + '"]');
          if (playBtn) playBtn.style.display = "inline-block";
        } else {
          btn.disabled = false;
          btn.textContent = "Summarize";
        }
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Summarize";
        document.getElementById("summary-" + id).textContent = "Could not load summary.";
      }
    }

    function playSummaryAudio(btn) {
      const id = btn.dataset.clusterId;
      new Audio("/api/summary/" + id + "/audio").play();
    }

    let currentRundownScope = null;
    async function loadRundown(scope, btn) {
      currentRundownScope = scope;
      document.querySelectorAll(".rundown-tab").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      const textEl = document.getElementById("rundownText");
      const playBtn = document.getElementById("rundownPlayBtn");
      textEl.innerHTML = '<p class="empty">Loading...</p>';
      playBtn.style.display = "none";
      try {
        const res = await fetch("/api/rundown?scope=" + scope);
        const data = await res.json();
        textEl.textContent = data.text || "No stories in this quadrant yet.";
        if (data.text) playBtn.style.display = "inline-block";
      } catch (err) {
        textEl.textContent = "Could not load rundown.";
      }
    }

    function playRundownAudio() {
      if (!currentRundownScope) return;
      new Audio("/api/rundown/audio?scope=" + currentRundownScope).play();
    }

    (function () {
      const square = document.getElementById("compassSquare");
      const marker = document.getElementById("compassMarker");
      const results = document.getElementById("compassResults");
      if (!square) return;
      let dragging = false;

      function setMarker(clientX, clientY) {
        const rect = square.getBoundingClientRect();
        let x = (clientX - rect.left) / rect.width;
        let y = (clientY - rect.top) / rect.height;
        x = Math.min(1, Math.max(0, x));
        y = Math.min(1, Math.max(0, y));
        marker.style.left = (x * 100) + "%";
        marker.style.top = (y * 100) + "%";
        const economic = x * 2 - 1;
        const authoritarian = 1 - y * 2;
        return { economic: economic, authoritarian: authoritarian };
      }

      async function fetchResults(economic, authoritarian) {
        results.innerHTML = '<p class="empty">Loading...</p>';
        try {
          const res = await fetch("/api/compass?economic=" + economic.toFixed(3) + "&authoritarian=" + authoritarian.toFixed(3));
          results.innerHTML = await res.text();
        } catch (err) {
          results.innerHTML = '<p class="empty">Could not load results.</p>';
        }
      }

      square.addEventListener("pointerdown", function (e) {
        dragging = true;
        setMarker(e.clientX, e.clientY);
        square.setPointerCapture(e.pointerId);
      });
      square.addEventListener("pointermove", function (e) {
        if (!dragging) return;
        setMarker(e.clientX, e.clientY);
      });
      square.addEventListener("pointerup", function (e) {
        if (!dragging) return;
        dragging = false;
        const point = setMarker(e.clientX, e.clientY);
        fetchResults(point.economic, point.authoritarian);
      });
    })();
  </script>
</body>
</html>`;
}

// --- Routes ---------------------------------------------------------------

app.get("/", async (req, res) => {
  try {
    const [heroClusters, bigTrending, todaysSong, ...categoryClusters] = await Promise.all([
      getTrendingClustersPriority({ tiers: HERO_TIERS, limit: 10 }),
      getTrendingClusters({ limit: 40 }),
      getTodaysSong(),
      ...CATEGORIES.map((cat) => getTrendingClusters({ category: cat.slug, limit: 10 })),
    ]);

    const categorySections = CATEGORIES.map((cat, i) => ({
      label: cat.label,
      clusters: categoryClusters[i],
    }));

    res.send(renderPage({ heroClusters, categorySections, bigTrending, todaysSong }));
  } catch (err) {
    console.error("[/] error:", err);
    res.status(500).send("Something broke. Check server logs.");
  }
});

app.get("/section/:category", async (req, res) => {
  try {
    const clusters = await getTrendingClusters({ category: req.params.category, limit: 50 });
    const meta = CATEGORIES.find((c) => c.slug === req.params.category);
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>${escapeHtml(meta?.label || req.params.category)} — DirectioNews</title>
      <style>body{font-family:Georgia,serif;max-width:900px;margin:0 auto;padding:20px;}
      .headline{margin-bottom:10px;} .headline a{color:#0000cc;font-weight:bold;text-decoration:none;font-size:16px;}
      .headline a:visited{color:#551a8b;} .meta{color:#666;font-size:12px;margin-left:6px;}</style></head>
      <body><h1>${escapeHtml(meta?.label || req.params.category)}</h1>${renderHeadlineList(clusters)}</body></html>`);
  } catch (err) {
    console.error("[/section] error:", err);
    res.status(500).send("Something broke. Check server logs.");
  }
});

app.get("/search", async (req, res) => {
  try {
    const q = (req.query.q || "").toString();
    const clusters = q ? await searchClusters({ query: q, limit: 40 }) : [];
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Search: ${escapeHtml(q)} — DirectioNews</title>
      <style>body{font-family:Georgia,serif;max-width:900px;margin:0 auto;padding:20px;}
      .headline{margin-bottom:14px;} .headline a{color:#0000cc;font-weight:bold;text-decoration:none;font-size:16px;}
      .headline a:visited{color:#551a8b;} .meta{color:#666;font-size:12px;margin-left:6px;}
      .summary-controls{margin-top:6px;} .summarize-btn,.play-btn{font-family:Georgia,serif;font-size:11px;padding:3px 8px;border:1px solid #999;background:#fff;border-radius:3px;cursor:pointer;}
      .summary-text{font-size:12px;color:#333;margin:6px 0;line-height:1.4;}
      form{margin-bottom:20px;display:flex;gap:8px;}
      input[type=text]{flex:1;font-size:14px;padding:8px;border:1px solid #999;border-radius:4px;}
      button{font-size:14px;padding:8px 14px;border:1px solid #000;background:#000;color:#fff;border-radius:4px;cursor:pointer;}
      </style></head>
      <body>
      <h1>Search</h1>
      <form action="/search" method="GET"><input type="text" name="q" value="${escapeHtml(q)}" autocomplete="off" /><button type="submit">Search</button></form>
      ${q ? renderHeadlineList(clusters) : `<p class="empty">Search for a headline keyword or a source name (e.g. "Politico").</p>`}
      <script>
        async function loadSummary(btn) {
          const id = btn.dataset.clusterId;
          btn.disabled = true; btn.textContent = "Loading...";
          try {
            const res = await fetch("/api/summary/" + id);
            const data = await res.json();
            document.getElementById("summary-" + id).textContent = data.summary || "No summary available.";
            if (data.summary) {
              btn.style.display = "none";
              const playBtn = document.querySelector('.play-btn[data-cluster-id="' + id + '"]');
              if (playBtn) playBtn.style.display = "inline-block";
            } else { btn.disabled = false; btn.textContent = "Summarize"; }
          } catch (err) { btn.disabled = false; btn.textContent = "Summarize"; }
        }
        function playSummaryAudio(btn) {
          const id = btn.dataset.clusterId;
          new Audio("/api/summary/" + id + "/audio").play();
        }
      </script>
      </body></html>`);
  } catch (err) {
    console.error("[/search] error:", err);
    res.status(500).send("Something broke. Check server logs.");
  }
});

app.get("/api/compass", async (req, res) => {
  try {
    const economic = Math.min(1, Math.max(-1, Number(req.query.economic) || 0));
    const authoritarian = Math.min(1, Math.max(-1, Number(req.query.authoritarian) || 0));
    const zone = findZoneForPoint(economic, authoritarian);
    const items = await searchNewsForZone(zone);
    res.type("html").send(renderCompassResultCards(zone.label, items));
  } catch (err) {
    console.error("[api/compass] error:", err);
    res.status(500).send(`<p class="empty">Something broke loading results.</p>`);
  }
});

app.get("/api/summary/:clusterId", async (req, res) => {
  const clusterId = Number(req.params.clusterId);
  if (!Number.isInteger(clusterId)) return res.status(400).json({ error: "invalid_cluster_id" });
  try {
    const summary = await getOrGenerateClusterSummary(clusterId);
    res.json({ summary });
  } catch (err) {
    console.error("[api/summary] error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.get("/api/summary/:clusterId/audio", async (req, res) => {
  const clusterId = Number(req.params.clusterId);
  if (!Number.isInteger(clusterId)) return res.status(400).send("invalid cluster id");
  try {
    const summary = await getOrGenerateClusterSummary(clusterId);
    if (!summary) return res.status(404).send("No summary available");
    const { audio_data, content_type } = await getOrSynthesizeAudio(summary);
    res.set("Content-Type", content_type).send(audio_data);
  } catch (err) {
    console.error("[api/summary/audio] error:", err);
    res.status(500).send("Could not generate audio");
  }
});

app.get("/api/rundown", async (req, res) => {
  const scope = RUNDOWN_SCOPE_VALUES.has(req.query.scope) ? req.query.scope : "all";
  try {
    const text = await getOrGenerateDailyRundown(scope);
    res.json({ text });
  } catch (err) {
    console.error("[api/rundown] error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.get("/api/rundown/audio", async (req, res) => {
  const scope = RUNDOWN_SCOPE_VALUES.has(req.query.scope) ? req.query.scope : "all";
  try {
    const text = await getOrGenerateDailyRundown(scope);
    if (!text) return res.status(404).send("No rundown available");
    const { audio_data, content_type } = await getOrSynthesizeAudio(text);
    res.set("Content-Type", content_type).send(audio_data);
  } catch (err) {
    console.error("[api/rundown/audio] error:", err);
    res.status(500).send("Could not generate audio");
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
  console.log(`[server] DirectioNews listening on port ${PORT}`);
});
