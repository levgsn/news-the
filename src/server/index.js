import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import {
  getTrendingClusters,
  getTrendingClustersPriority,
} from "../ranking/trending.js";
import { getTodaysSong, getUpcomingSongs, setSongForDate, deleteSongForDate } from "../ranking/songSchedule.js";
import { searchNewsForCell } from "../ranking/compassSearch.js";
import { getArticlesForBlend } from "../ranking/compassStore.js";
import { getSearchTermsForCell } from "../ai/compassQueries.js";
import { getOrGenerateClusterSummary } from "../ai/summaries.js";
import { getOrSynthesizeAudio } from "../ai/audioCache.js";
import {
  getTodaysSummary,
  getTodaysSummaryAudio,
  generateAiDailySummary,
  generateAiDailySummaryAudio,
  setUserDailySummary,
} from "../ai/dailySummary.js";
import { backfillImagesForClusters } from "../ingestion/backfillImages.js";
import { CATEGORIES } from "../config/categories.js";
import { getNearestCells, quadrantBlend } from "../config/compassGrid.js";

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: false }));
// Static assets (the engraved side-rail artwork). Long cache: the file is
// content-stable, and it's requested on every page load.
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public");
app.use(express.static(PUBLIC_DIR, { maxAge: "7d" }));
// Memory storage (not disk) since the recording gets stored straight into
// Postgres as BYTEA -- Railway's filesystem is ephemeral anyway. 25MB caps
// a several-minutes-long voice recording without allowing huge uploads;
// this route is behind the ADMIN_KEY gate regardless.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "";

// Fallback track when no song_schedule row exists for today. Spotify's
// OFFICIAL embed player for "Changes" by 2Pac (1998 Greatest Hits)
// (open.spotify.com/track/3pclEGdsAxuNaSU7BGgtFb) — Spotify's own licensed
// widget; nothing is hosted or reproduced by this site.
const DEFAULT_SONG_TRACK_ID = "3pclEGdsAxuNaSU7BGgtFb";

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

// Eastern Time, the newsroom convention -- shown next to every story
// sitewide so readers can tell at a glance how fresh a story is.
const WHEN_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
function formatWhen(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return `${WHEN_FORMAT.format(d)} ET`;
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
    <button class="close-btn" type="button" data-cluster-id="${clusterId}" style="display:none" onclick="closeSummary(this)">Close</button>
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
      const when = formatWhen(c.top_published_at);
      return `<div class="headline">
        <a href="${url}" target="_blank" rel="noopener">${title}</a>
        <span class="meta">(${src}${count > 1 ? ` +${count - 1} more` : ""}${when ? ` &middot; ${when}` : ""})</span>
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
        ? `<img src="${escapeHtml(c.top_image)}" alt="" loading="lazy" onerror="handleImgError(this)" />`
        : `<div class="thumb-placeholder" style="background:${placeholderColor(src)}"><span>${src}</span></div>`;
      const when = formatWhen(c.top_published_at);
      return `<div class="hero-card">
        <a class="hero-card-link" href="${url}" target="_blank" rel="noopener">
          <div class="hero-thumb" data-fallback-color="${placeholderColor(src)}" data-fallback-label="${src}">${thumb}</div>
          <div class="hero-title">${title}</div>
          <div class="hero-meta">${src}${when ? ` &middot; ${when}` : ""}</div>
        </a>
        ${renderSummaryControls(c.id)}
      </div>`;
    })
    .join("\n");
}

// Live web-search results (compassSearch.js, via GNews.io) for whichever
// quadrant was clicked, Drudge Report style: the single most-relevant
// story gets a featured thumbnail+title+link, everything else is a plain
// headline list below. No heading -- just the results. GNews returns real
// article URLs and real thumbnail images, so the featured card shows an
// actual photo when available (with the same hotlink-failure fallback
// used on the hero grid).
function renderCompassResults(blend, items) {
  // The dropped point's "rating" -- e.g. "62% Authoritarian Left / 38%
  // Libertarian Left" -- always shown, even over an empty result list.
  const blendHtml = `<div class="compass-blend">${blend
    .map((b) => `<strong>${b.pct}%</strong> ${escapeHtml(b.label)}`)
    .join(" &middot; ")}</div>`;

  if (items.length === 0) {
    return `${blendHtml}<p class="empty">No stories stored for this spot yet — results fill in after the next daily refresh.</p>`;
  }

  const [featured, ...rest] = items;
  const featuredWhen = formatWhen(featured.publishedAt);
  const featuredThumb = featured.image
    ? `<img src="${escapeHtml(featured.image)}" alt="" loading="lazy" onerror="handleImgError(this)" />`
    : `<div class="thumb-placeholder" style="background:${placeholderColor(featured.outlet)}"><span>${escapeHtml(featured.outlet)}</span></div>`;
  const featuredHtml = `<a class="compass-featured" href="${escapeHtml(featured.url)}" target="_blank" rel="noopener">
    <div class="compass-featured-thumb" data-fallback-color="${placeholderColor(featured.outlet)}" data-fallback-label="${escapeHtml(featured.outlet)}">${featuredThumb}</div>
    <div class="compass-featured-title">${escapeHtml(featured.title)}</div>
    <div class="compass-featured-meta">${escapeHtml(featured.outlet)}${featuredWhen ? ` &middot; ${featuredWhen}` : ""}</div>
  </a>`;

  const listHtml = rest
    .map((item) => {
      const when = formatWhen(item.publishedAt);
      return `<div class="headline">
        <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.title.toUpperCase())}</a>
        <span class="meta">(${escapeHtml(item.outlet)}${when ? ` &middot; ${when}` : ""})</span>
      </div>`;
    })
    .join("\n");

  return `${blendHtml}${featuredHtml}${listHtml ? `<div class="compass-list">${listHtml}</div>` : ""}`;
}

// Public-facing "Today's Summary" -- either AI-generated or the site
// owner's own recorded transcript (managed via /admin/summary), whichever
// was saved most recently. Text is rendered server-side directly (no
// client fetch needed, it's a cheap single-row lookup); the Listen button
// only appears if audio actually exists.
function renderDailySummarySection(dailySummary) {
  if (!dailySummary?.text_content) {
    return `<details class="daily-summary-widget reveal">
      <summary>Today's Summary</summary>
      <p class="empty">No summary posted yet today.</p>
    </details>`;
  }
  return `<details class="daily-summary-widget reveal">
    <summary>Today's Summary</summary>
    <p class="daily-summary-text">${escapeHtml(dailySummary.text_content)}</p>
    ${dailySummary.has_audio ? `<button type="button" class="play-btn daily-summary-play-btn" onclick="playDailySummaryAudio()">&#128266; Listen</button>` : ""}
  </details>`;
}

function renderPage({ heroClusters, categorySections, bigTrending, todaysSong, dailySummary }) {
  const categoriesHtml = categorySections
    .map(
      ({ label, clusters }) => `<section class="category-section reveal">
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
<title>DirectioNews</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;700;900&display=swap" rel="stylesheet" />
<style>
  :root {
    --ink: #000;
    --paper: #fff;
    --link: #000;
    --visited: #000;
    --meta: #666;
    /* Body copy is Times New Roman sitewide; --font-header is kept for the
       masthead only (brand wordmark + glitch logo), which stays condensed. */
    --font: 'Times New Roman', Times, serif;
    --font-header: 'Roboto Condensed', Arial, Helvetica, sans-serif;
  }

  /* ---------- Scroll reveal ---------- */
  /* Everything fades in on load; sections drop down into place as they
     scroll into view and then STAY put -- the observer unobserves on
     first reveal, so nothing re-hides when scrolling back up. */
  body { opacity: 0; transition: opacity 0.6s ease; }
  body.loaded { opacity: 1; }
  .reveal {
    opacity: 0;
    transform: translateY(-28px);
    transition: opacity 0.7s ease, transform 0.7s ease;
  }
  .reveal.shown { opacity: 1; transform: none; }
  @media (prefers-reduced-motion: reduce) {
    body, .reveal { opacity: 1 !important; transform: none !important; transition: none !important; }
  }

  /* ---------- Engraved side rails ---------- */
  .side-rail {
    position: absolute;
    top: 0;
    width: 150px;
    display: flex;
    flex-direction: column;
    pointer-events: none;
    z-index: 0;
  }
  .side-rail-left { left: 0; }
  .side-rail-right { right: 0; }
  /* Panels reveal like everything else, but settle at a low opacity so the
     artwork reads as a watermark behind the news rather than competing
     with it -- hence their own .shown rule instead of the generic one. */
  .side-rail-panel {
    width: 100%;
    aspect-ratio: 320 / 569;
    background-image: url('/side-art.png');
    background-size: contain;
    background-repeat: no-repeat;
    opacity: 0;
    transform: translateY(-28px);
    transition: opacity 0.7s ease, transform 0.7s ease;
  }
  .side-rail-panel.shown { opacity: 0.16; transform: none; }
  .side-rail-right .side-rail-panel { transform: translateY(-28px) scaleX(-1); }
  .side-rail-right .side-rail-panel.shown { transform: scaleX(-1); }
  /* Below ~1500px the rails would crowd the 1200px content column. */
  @media (max-width: 1500px) { .side-rail { display: none; } }
  * { box-sizing: border-box; }
  body {
    background: var(--paper);
    color: var(--ink);
    font-family: var(--font);
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
  /* The masthead is the one place that keeps the condensed sans face. */
  .brand h1 {
    font-family: var(--font-header);
    font-size: 30px;
    font-weight: 900;
    letter-spacing: 0.5px;
    margin: 0;
  }
  .brand .subtitle {
    font-size: 12px;
    color: var(--meta);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 2px;
  }
  .social-links { display: flex; gap: 12px; margin-top: 10px; }
  .social-link { color: #000; display: inline-flex; }
  .social-link svg { width: 18px; height: 18px; }
  .social-link:hover { opacity: 0.6; }
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
    font-family: var(--font-header);
    font-weight: 900;
    font-size: clamp(22px, 4vw, 38px);
    line-height: 1.2;
    color: #2b0a4d;
    letter-spacing: 0.5px;
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
    font-family: var(--font);
  }

  /* ---------- Section headers (shared look) ---------- */
  .hero-trending h2,
  .category-section h2,
  .big-trending h2,
  .compass-widget h2 {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    border-bottom: 2px solid #000;
    padding-bottom: 4px;
    margin: 0 0 10px 0;
    text-align: center;
  }
  /* "Curate" stands alone above the circle -- no rule underneath it. */
  .compass-widget h2 { border-bottom: none; padding-bottom: 0; }

  /* ---------- Today's Summary ---------- */
  .daily-summary-widget {
    margin-bottom: 32px;
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 16px 20px;
    background: #fafafa;
  }
  .daily-summary-widget summary {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    cursor: pointer;
  }
  .daily-summary-widget[open] summary {
    border-bottom: 2px solid #000;
    padding-bottom: 4px;
    margin-bottom: 10px;
  }
  .daily-summary-text {
    max-width: 720px;
    margin: 12px auto 12px;
    font-size: 15px;
    white-space: pre-wrap;
  }
  .daily-summary-play-btn { display: block; margin: 0 auto; }

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
    font-weight: 700;
    text-align: center;
    padding: 6px;
    color: #333;
  }
  .hero-title { font-weight: 700; font-size: 14px; margin-top: 6px; color: var(--link); text-align: center; }
  .hero-meta { font-size: 11px; color: var(--meta); text-align: center; }

  /* ---------- Per-story summary/audio controls ---------- */
  .summary-controls { margin-top: 6px; }
  .summarize-btn, .play-btn, .close-btn {
    font-family: var(--font);
    font-size: 11px;
    padding: 3px 8px;
    border: 1px solid #999;
    background: #fff;
    border-radius: 3px;
    cursor: pointer;
    margin-right: 4px;
  }
  .hero-card .summary-controls { text-align: center; }
  .summarize-btn:hover, .play-btn:hover, .close-btn:hover { background: #eee; }
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
  .compass-grid-lines {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image:
      repeating-linear-gradient(to right, rgba(0, 0, 0, 0.35) 0, rgba(0, 0, 0, 0.35) 1px, transparent 1px, transparent 25%),
      repeating-linear-gradient(to bottom, rgba(0, 0, 0, 0.35) 0, rgba(0, 0, 0, 0.35) 1px, transparent 1px, transparent 25%);
  }
  .compass-q-al { top: 0; left: 0; background: #f6b8b8; }
  .compass-q-ar { top: 0; right: 0; background: #8fd0f0; }
  .compass-q-ll { bottom: 0; left: 0; background: #bfe3b6; }
  .compass-q-lr { bottom: 0; right: 0; background: #f2ee9e; }
  .compass-axis-label {
    position: absolute;
    font-size: 12px;
    font-weight: 700;
    color: #000;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    pointer-events: none;
    text-shadow: 0 0 4px rgba(255, 255, 255, 0.85);
  }
  .compass-top { top: 18px; left: 50%; transform: translateX(-50%); }
  .compass-bottom { bottom: 18px; left: 50%; transform: translateX(-50%); }
  .compass-left { top: 50%; left: 18px; transform: translateY(-50%); }
  .compass-right { top: 50%; right: 18px; transform: translateY(-50%); }
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
    max-width: 480px;
  }
  .compass-blend {
    font-size: 14px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    border-bottom: 2px solid #000;
    padding-bottom: 4px;
    margin: 0 0 12px 0;
  }
  .compass-featured { color: inherit; text-decoration: none; display: block; margin-bottom: 16px; }
  .compass-featured-thumb {
    width: 100%;
    max-width: 280px;
    aspect-ratio: 16 / 10;
    overflow: hidden;
    background: #eee;
    border: 1px solid #ccc;
  }
  .compass-featured-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .compass-featured-title { font-weight: 700; font-size: 16px; margin-top: 6px; color: var(--link); }
  .compass-featured-meta { font-size: 11px; color: var(--meta); }
  .compass-list .headline { margin-bottom: 10px; }

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
    font-weight: 700;
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
  <div class="side-rail side-rail-left" id="sideRailLeft" aria-hidden="true"></div>
  <div class="side-rail side-rail-right" id="sideRailRight" aria-hidden="true"></div>

  <header class="site-header">
    <div class="brand">
      <h1>DirectioNews</h1>
      <div class="subtitle">Trending across ${heroClusters.length + bigTrending.length} stories &middot; refreshed continuously</div>
      <div class="social-links">
        <a href="#" class="social-link" aria-label="Instagram"><svg viewBox="0 0 24 24"><rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.5" cy="6.5" r="1.3" fill="currentColor"/></svg></a>
        <a href="#" class="social-link" aria-label="X"><svg viewBox="0 0 24 24"><path d="M3.5 3.5l17 17M20.5 3.5l-17 17" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg></a>
        <a href="#" class="social-link" aria-label="TikTok"><svg viewBox="0 0 24 24"><path d="M15 3v10.8a3.7 3.7 0 1 1-3.2-3.66V13a1.6 1.6 0 1 0 1.6 1.6V3h1.6z" fill="currentColor"/><path d="M15 3a5.2 5.2 0 0 0 5 5V6.4A3.6 3.6 0 0 1 16.6 3H15z" fill="currentColor"/></svg></a>
      </div>
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

  ${renderDailySummarySection(dailySummary)}

  <section class="hero-trending reveal">
    <h2>U.S. Politics &middot; World / Geopolitics &middot; Crime &amp; Legal</h2>
    <div class="hero-grid">
      ${renderHeroCards(heroClusters)}
    </div>
  </section>

  <section class="compass-widget reveal">
    <h2>Curate</h2>
    <p class="compass-hint">Click or drag anywhere on the chart below — we'll search the web live for news matching that spot.</p>
    <div class="compass-layout">
      <div class="compass-square" id="compassSquare">
        <div class="compass-quadrant compass-q-al"></div>
        <div class="compass-quadrant compass-q-ar"></div>
        <div class="compass-quadrant compass-q-ll"></div>
        <div class="compass-quadrant compass-q-lr"></div>
        <div class="compass-grid-lines"></div>
        <div class="compass-axis-label compass-top">Authoritarian</div>
        <div class="compass-axis-label compass-bottom">Libertarian</div>
        <div class="compass-axis-label compass-left">Econ. Left</div>
        <div class="compass-axis-label compass-right">Econ. Right</div>
        <div class="compass-marker" id="compassMarker"></div>
      </div>
      <div class="compass-results" id="compassResults">
        <p class="empty">Click the chart to see live curated stories.</p>
      </div>
    </div>
  </section>

  <div class="main-layout reveal">
    <main class="categories">
      ${categoriesHtml}
    </main>
  </div>

  <section class="big-trending reveal">
    <h2>Trending Now</h2>
    ${renderHeadlineList(bigTrending)}
  </section>

  <script>
    // Some outlets' CDNs (e.g. Variety, Deadline) hotlink-block image
    // requests from other sites -- the URL is real (our server-side
    // og:image scrape found it fine), but the browser's own <img> request
    // gets refused. Swap to the same colored placeholder used when there
    // was never a URL at all, rather than showing a broken-image icon.
    // Fade the page in, build the side rails to match the document's real
    // height, then reveal every .reveal element as it scrolls into view.
    // unobserve() on first reveal is what makes elements STAY once seen.
    (function () {
      function buildRails() {
        var docHeight = document.body.scrollHeight;
        var railWidth = 150;
        var panelHeight = railWidth * (569 / 320);
        var count = Math.ceil(docHeight / panelHeight);
        ["sideRailLeft", "sideRailRight"].forEach(function (id) {
          var rail = document.getElementById(id);
          if (!rail) return;
          rail.style.height = docHeight + "px";
          rail.innerHTML = "";
          for (var i = 0; i < count; i++) {
            var panel = document.createElement("div");
            panel.className = "side-rail-panel";
            rail.appendChild(panel);
          }
        });
      }

      function observeAll() {
        var targets = document.querySelectorAll(".reveal, .side-rail-panel");
        if (!("IntersectionObserver" in window)) {
          targets.forEach(function (el) { el.classList.add("shown"); });
          return;
        }
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("shown");
            io.unobserve(entry.target);
          });
        }, { threshold: 0.08, rootMargin: "0px 0px -40px 0px" });
        targets.forEach(function (el) { io.observe(el); });
      }

      window.addEventListener("load", function () {
        document.body.classList.add("loaded");
        buildRails();
        observeAll();
      });

      var resizeTimer;
      window.addEventListener("resize", function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () { buildRails(); observeAll(); }, 200);
      });
    })();

    function handleImgError(img) {
      const thumb = img.parentElement;
      const div = document.createElement("div");
      div.className = "thumb-placeholder";
      div.style.background = thumb.dataset.fallbackColor;
      const span = document.createElement("span");
      span.textContent = thumb.dataset.fallbackLabel;
      div.appendChild(span);
      thumb.innerHTML = "";
      thumb.appendChild(div);
    }

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
          const closeBtn = document.querySelector('.close-btn[data-cluster-id="' + id + '"]');
          if (closeBtn) closeBtn.style.display = "inline-block";
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

    function playDailySummaryAudio() {
      new Audio("/api/daily-summary/audio").play();
    }

    function closeSummary(btn) {
      const id = btn.dataset.clusterId;
      document.getElementById("summary-" + id).textContent = "";
      btn.style.display = "none";
      const playBtn = document.querySelector('.play-btn[data-cluster-id="' + id + '"]');
      if (playBtn) playBtn.style.display = "none";
      const summarizeBtn = document.querySelector('.summarize-btn[data-cluster-id="' + id + '"]');
      if (summarizeBtn) {
        summarizeBtn.style.display = "inline-block";
        summarizeBtn.disabled = false;
        summarizeBtn.textContent = "Summarize";
      }
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
    const [heroClusters, bigTrending, todaysSong, dailySummary, ...categoryClusters] = await Promise.all([
      getTrendingClustersPriority({ tiers: HERO_TIERS, limit: 10 }),
      getTrendingClusters({ limit: 40 }),
      getTodaysSong(),
      getTodaysSummary(),
      ...CATEGORIES.map((cat) => getTrendingClusters({ category: cat.slug, limit: 10 })),
    ]);

    // Guarantees the front 10 hero thumbnails actually show something real
    // rather than depending on whenever `npm run ingest` last ran --
    // fetches og:image live for any of these 10 still missing one, and
    // persists it so this cost is paid at most once per story.
    await backfillImagesForClusters(heroClusters);

    const categorySections = CATEGORIES.map((cat, i) => ({
      label: cat.label,
      clusters: categoryClusters[i],
    }));

    res.send(renderPage({ heroClusters, categorySections, bigTrending, todaysSong, dailySummary }));
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
      <style>body{font-family:'Roboto Condensed',Arial,sans-serif;max-width:900px;margin:0 auto;padding:20px;}
      .headline{margin-bottom:10px;} .headline a{color:#000;font-weight:700;text-decoration:none;font-size:16px;}
      .headline a:visited{color:#000;} .meta{color:#666;font-size:12px;margin-left:6px;}</style></head>
      <body><h1>${escapeHtml(meta?.label || req.params.category)}</h1>${renderHeadlineList(clusters)}</body></html>`);
  } catch (err) {
    console.error("[/section] error:", err);
    res.status(500).send("Something broke. Check server logs.");
  }
});

app.get("/api/compass", async (req, res) => {
  try {
    const economic = Math.min(1, Math.max(-1, Number(req.query.economic) || 0));
    const authoritarian = Math.min(1, Math.max(-1, Number(req.query.authoritarian) || 0));
    // The dropped point gets a quadrant blend score ("62% Authoritarian
    // Left / 38% Libertarian Left"), and results are mixed from the
    // clicked cell and its nearest neighbor in that same proportion.
    // Reads come from compass_cell_articles -- populated by the DAILY
    // refresh in `npm run ingest` (AI-generated terms per cell, GNews
    // scan, stored in Postgres) -- so clicks are instant and never spend
    // GNews quota. Live fetches below are only a bootstrap for a cell
    // that has no stored stories yet (e.g. before the first refresh ran).
    const blend = quadrantBlend(economic, authoritarian);
    const { primary, secondary, rest } = getNearestCells(economic, authoritarian);

    let items = await getArticlesForBlend({ primary, secondary, rest, primaryShare: blend[0].pct / 100 });
    if (items.length === 0) {
      const terms = await getSearchTermsForCell(primary);
      items = await searchNewsForCell(primary, terms);
    }
    if (items.length === 0) {
      items = await searchNewsForCell({ key: "fallback_politics" }, ["politics"]);
    }

    res.type("html").send(renderCompassResults(blend, items));
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

app.get("/api/daily-summary/audio", async (req, res) => {
  try {
    const audio = await getTodaysSummaryAudio();
    if (!audio) return res.status(404).send("No audio available today");
    res.set("Content-Type", audio.content_type).send(audio.audio_data);
  } catch (err) {
    console.error("[api/daily-summary/audio] error:", err);
    res.status(500).send("Could not load audio");
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
  try {
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
        body{font-family:'Roboto Condensed',Arial,sans-serif;max-width:700px;margin:40px auto;padding:0 20px;}
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
          <div><label>Spotify Track ID</label><input type="text" name="track_id" required placeholder="e.g. 3pclEGdsAxuNaSU7BGgtFb" size="30" /></div>
          <div><label>Label (optional)</label><input type="text" name="label" placeholder="Song &mdash; Artist" size="24" /></div>
          <button type="submit">Save</button>
        </form>
        <table>
          <thead><tr><th>Date</th><th>Track ID</th><th>Label</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="4">No upcoming songs scheduled — today falls back to the default track.</td></tr>`}</tbody>
        </table>
      </body></html>`);
  } catch (err) {
    console.error("[admin/song] error:", err);
    res.status(500).send("Something broke. Check server logs.");
  }
});

app.post("/admin/song", requireAdminKey, async (req, res) => {
  try {
    const { play_date, track_id, label } = req.body;
    if (!play_date || !track_id) return res.status(400).send("Missing play_date or track_id");
    await setSongForDate(play_date, track_id.trim(), (label || "").trim());
    res.redirect(`/admin/song?key=${encodeURIComponent(req.query.key)}`);
  } catch (err) {
    console.error("[admin/song POST] error:", err);
    res.status(500).send("Something broke. Check server logs.");
  }
});

app.post("/admin/song/delete", requireAdminKey, async (req, res) => {
  try {
    const { play_date } = req.body;
    if (play_date) await deleteSongForDate(play_date);
    res.redirect(`/admin/song?key=${encodeURIComponent(req.query.key)}`);
  } catch (err) {
    console.error("[admin/song/delete] error:", err);
    res.status(500).send("Something broke. Check server logs.");
  }
});

// --- Admin: today's summary --------------------------------------------
// Same shared-secret gate as /admin/song. Either generate an AI summary
// from today's trending headlines, or paste your own transcript and/or
// upload your own voice recording -- whichever was saved most recently
// (per field) is what the public homepage shows.

app.get("/admin/summary", requireAdminKey, async (req, res) => {
  try {
    const current = await getTodaysSummary();
    const key = escapeHtml(req.query.key);
    const statusLine = current?.text_content
      ? `Current text: <strong>${current.text_source === "ai" ? "AI-generated" : "Your recording"}</strong>. Audio: <strong>${current.has_audio ? `set (${current.audio_source})` : "none yet"}</strong>.`
      : "Nothing set for today yet.";

    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Daily Summary Admin</title>
      <style>
        body{font-family:'Roboto Condensed',Arial,sans-serif;max-width:700px;margin:40px auto;padding:0 20px;}
        textarea{width:100%;font-family:inherit;font-size:14px;padding:8px;box-sizing:border-box;}
        input,button{font-size:14px;padding:6px;}
        form{margin-top:20px;padding-top:16px;border-top:1px solid #ddd;}
        label{font-size:12px;color:#555;display:block;margin-bottom:4px;}
        blockquote{background:#fafafa;border:1px solid #ddd;padding:12px;font-size:14px;white-space:pre-wrap;}
        .error-banner{background:#fdecea;border:1px solid #f5c2c0;color:#9c2f2a;padding:10px 12px;font-size:13px;margin-bottom:16px;}
      </style></head>
      <body>
        <h1>Today's Summary &mdash; Admin</h1>
        ${req.query.error ? `<div class="error-banner">${escapeHtml(req.query.error)}</div>` : ""}
        <p>${statusLine}</p>
        ${current?.text_content ? `<blockquote>${escapeHtml(current.text_content)}</blockquote>` : ""}

        <form method="POST" action="/admin/summary/generate?key=${key}">
          <button type="submit">Generate Text with AI</button>
        </form>

        <form method="POST" action="/admin/summary/generate-audio?key=${key}">
          <button type="submit"${current?.text_content ? "" : " disabled"}>Generate AI Audio for Current Text</button>
        </form>

        <form method="POST" action="/admin/summary?key=${key}" enctype="multipart/form-data">
          <div><label>Your transcript (leave blank to keep the current text)</label>
            <textarea name="text" rows="8" placeholder="Paste or write today's transcript..."></textarea>
          </div>
          <div style="margin-top:10px"><label>Your voice recording (leave blank to keep the current audio)</label>
            <input type="file" name="audio" accept="audio/*" />
          </div>
          <button type="submit" style="margin-top:10px">Save My Version</button>
        </form>
      </body></html>`);
  } catch (err) {
    console.error("[admin/summary] error:", err);
    res.status(500).send("Something broke. Check server logs.");
  }
});

app.post("/admin/summary/generate", requireAdminKey, async (req, res) => {
  try {
    await generateAiDailySummary();
    res.redirect(`/admin/summary?key=${encodeURIComponent(req.query.key)}`);
  } catch (err) {
    console.error("[admin/summary/generate] error:", err);
    res.redirect(`/admin/summary?key=${encodeURIComponent(req.query.key)}&error=${encodeURIComponent(err.message)}`);
  }
});

app.post("/admin/summary/generate-audio", requireAdminKey, async (req, res) => {
  try {
    await generateAiDailySummaryAudio();
    res.redirect(`/admin/summary?key=${encodeURIComponent(req.query.key)}`);
  } catch (err) {
    console.error("[admin/summary/generate-audio] error:", err);
    res.redirect(`/admin/summary?key=${encodeURIComponent(req.query.key)}&error=${encodeURIComponent(err.message)}`);
  }
});

app.post("/admin/summary", requireAdminKey, upload.single("audio"), async (req, res) => {
  try {
    const text = (req.body.text || "").trim();
    await setUserDailySummary({
      text: text || null,
      audioBuffer: req.file?.buffer || null,
      audioContentType: req.file?.mimetype || null,
    });
    res.redirect(`/admin/summary?key=${encodeURIComponent(req.query.key)}`);
  } catch (err) {
    console.error("[admin/summary] error:", err);
    res.redirect(`/admin/summary?key=${encodeURIComponent(req.query.key)}&error=${encodeURIComponent(err.message)}`);
  }
});

app.listen(PORT, () => {
  console.log(`[server] DirectioNews listening on port ${PORT}`);
});
