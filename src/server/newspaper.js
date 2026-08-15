import { CATEGORIES } from "../config/categories.js";
import { LEAN_LABELS } from "../config/outletLeans.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function placeholderColor(name) {
  let hash = 0;
  for (let i = 0; i < String(name).length; i++) hash = String(name).charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 30%, 88%)`;
}

// Eastern Time, the newsroom convention -- shown next to every story so
// readers can tell at a glance how fresh something is.
const WHEN_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
export function formatWhen(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return `${WHEN_FORMAT.format(d)} ET`;
}

const EDITION_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});
export function editionDate() {
  return EDITION_FORMAT.format(new Date());
}

// `isStock` marks images that came from the keyword fallback rather than
// the publisher. Those get a small corner label: a generic photo matching
// a headline keyword would otherwise read as documentary evidence of the
// event itself, which it isn't.
function thumb(imageUrl, label, cls, isStock = false) {
  const color = placeholderColor(label || "");
  const inner = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" onerror="handleImgError(this)" />`
    : `<div class="thumb-placeholder" style="background:${color}"><span>${escapeHtml(label || "")}</span></div>`;
  const tag = imageUrl && isStock ? `<span class="stock-tag">stock</span>` : "";
  return `<div class="${cls}" data-fallback-color="${color}" data-fallback-label="${escapeHtml(label || "")}">${inner}${tag}</div>`;
}

// Per-story AI controls. Nothing fires until the reader clicks: the text
// summary on "Summarize", and audio only on the separate Listen button.
function summaryControls(clusterId) {
  return `<div class="summary-controls">
    <button class="summarize-btn" type="button" data-cluster-id="${clusterId}" onclick="loadSummary(this)">Summarize</button>
    <div class="summary-text" id="summary-${clusterId}"></div>
    <button class="play-btn" type="button" data-cluster-id="${clusterId}" style="display:none" onclick="playSummaryAudio(this)">&#128266; Listen</button>
    <button class="close-btn" type="button" data-cluster-id="${clusterId}" style="display:none" onclick="closeSummary(this)">Close</button>
  </div>`;
}

function headlineRow(c) {
  const when = formatWhen(c.top_published_at);
  const count = Number(c.source_count) || 1;
  return `<div class="headline">
    <a href="${escapeHtml(c.top_url || "#")}" target="_blank" rel="noopener">${escapeHtml((c.representative_title || "").toUpperCase())}</a>
    <span class="meta">(${escapeHtml(c.top_source || "")}${count > 1 ? ` +${count - 1} more` : ""}${when ? ` &middot; ${when}` : ""})</span>
    ${summaryControls(c.id)}
  </div>`;
}

// ---------------------------------------------------------------------------
// Page: cover
// ---------------------------------------------------------------------------

function renderCover(storyCount) {
  return `<section class="page page-cover" data-page="0">
    <div class="cover-inner">
      <div class="cover-rule"></div>
      <h1 class="cover-masthead">DirectioNews</h1>
      <div class="cover-rule"></div>
      <div class="cover-date">${escapeHtml(editionDate())}</div>
      <div class="cover-tagline">Direct Your News</div>
      <div class="cover-count">${storyCount} stories in today's edition</div>
      <button type="button" class="cover-cta" onclick="goToPage(1)">
        See what's happening
        <span class="cover-arrow">&rarr;</span>
      </button>
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Page: front page (breaking + top 10 + Summarize All)
// ---------------------------------------------------------------------------

function renderFrontPage(breaking, trending, dailySummary) {
  const summaryDropdown = dailySummary?.text_content
    ? `<details class="daily-summary-widget">
        <summary>Today's Summary</summary>
        <p class="daily-summary-text">${escapeHtml(dailySummary.text_content)}</p>
        ${dailySummary.has_audio ? `<button type="button" class="play-btn" onclick="playDailySummaryAudio()">&#128266; Listen</button>` : ""}
      </details>`
    : "";

  const breakingHtml = breaking
    ? `<div class="breaking">
        <div class="breaking-banner">
          <span class="breaking-banner-text">Breaking News</span>
        </div>
        <a class="breaking-link" href="${escapeHtml(breaking.top_url || "#")}" target="_blank" rel="noopener">
          ${thumb(breaking.top_image, breaking.top_source, "breaking-thumb", breaking.top_image_is_stock)}
          <h2 class="breaking-title">${escapeHtml(breaking.representative_title || "")}</h2>
        </a>
        <div class="breaking-meta">${escapeHtml(breaking.top_source || "")}${formatWhen(breaking.top_published_at) ? ` &middot; ${formatWhen(breaking.top_published_at)}` : ""}</div>
        ${summaryControls(breaking.id)}
      </div>`
    : `<p class="empty">No breaking story yet today.</p>`;

  const cards = trending.length
    ? trending
        .map(
          (c) => `<div class="tr-card">
            <a class="tr-link" href="${escapeHtml(c.top_url || "#")}" target="_blank" rel="noopener">
              ${thumb(c.top_image, c.top_source, "tr-thumb", c.top_image_is_stock)}
              <div class="tr-title">${escapeHtml(c.representative_title || "")}</div>
              <div class="tr-meta">${escapeHtml(c.top_source || "")}${formatWhen(c.top_published_at) ? ` &middot; ${formatWhen(c.top_published_at)}` : ""}</div>
            </a>
            ${summaryControls(c.id)}
          </div>`
        )
        .join("\n")
    : `<p class="empty">No trending stories yet &mdash; run <code>npm run ingest</code>.</p>`;

  return `<section class="page" data-page="1">
    ${pageHeader("The Front Page")}
    ${summaryDropdown}
    <div class="front-actions">
      <button type="button" class="big-btn" id="summarizeAllBtn" onclick="summarizeFrontPage()">Summarize All</button>
      <button type="button" class="big-btn" id="frontAudioBtn" style="display:none" onclick="playFrontAudio()">&#128266; Listen</button>
      <button type="button" class="big-btn" id="frontCloseBtn" style="display:none" onclick="closeFrontSummary()">Close</button>
    </div>
    <div class="front-summary" id="frontSummary"></div>
    ${breakingHtml}
    <h3 class="section-rule">Today's Top 10</h3>
    <div class="tr-grid">${cards}</div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Page: Trending on X
// ---------------------------------------------------------------------------

function renderXPage(xData) {
  if (!xData) {
    return `<section class="page" data-page="2">
      ${pageHeader("Trending on X")}
      <div class="notice">
        <p><strong>Not connected yet.</strong> X removed free API access in 2023 &mdash; live trends, tweets and replies require a paid tier (Basic, roughly $200/month).</p>
        <p>This page is fully built and will populate automatically once <code>X_BEARER_TOKEN</code> is set. Nothing else needs to change.</p>
        <p class="notice-small">On verification: the original blue check was retired platform-wide in 2023. The closest filter the API still offers is the gold (business) and grey (government) badges, which are granted rather than purchased &mdash; that's what the top-comments filter uses.</p>
      </div>
    </section>`;
  }

  const trendsHtml = xData.trends?.length
    ? `<div class="x-tags">${xData.trends
        .map(
          (t) =>
            `<span class="x-tag">${escapeHtml(t.name)}${t.volume ? `<em>${Number(t.volume).toLocaleString()} posts</em>` : ""}</span>`
        )
        .join("")}</div>`
    : `<p class="empty">No trends returned.</p>`;

  const tweetsHtml = xData.tweets?.length
    ? xData.tweets
        .map((tw) => {
          const badge = tw.author?.verifiedType
            ? `<span class="x-badge x-badge-${escapeHtml(tw.author.verifiedType)}">${escapeHtml(tw.author.verifiedType)}</span>`
            : "";
          const replies = (tw.replies || []).length
            ? `<div class="x-replies"><div class="x-replies-label">Top verified replies</div>${tw.replies
                .map(
                  (r) => `<div class="x-reply">
                    <div class="x-reply-author">${escapeHtml(r.author.name)} <span>@${escapeHtml(r.author.username)}</span> <span class="x-badge x-badge-${escapeHtml(r.author.verifiedType)}">${escapeHtml(r.author.verifiedType)}</span></div>
                    <div class="x-reply-text">${escapeHtml(r.text)}</div>
                  </div>`
                )
                .join("")}</div>`
            : `<div class="x-replies"><div class="x-replies-label">No verified replies found.</div></div>`;
          return `<div class="x-tweet">
            <div class="x-tweet-author">${escapeHtml(tw.author?.name || "Unknown")} <span>@${escapeHtml(tw.author?.username || "")}</span> ${badge}</div>
            <div class="x-tweet-text">${escapeHtml(tw.text)}</div>
            <div class="x-tweet-meta">${Number(tw.likes).toLocaleString()} likes${formatWhen(tw.createdAt) ? ` &middot; ${formatWhen(tw.createdAt)}` : ""}</div>
            ${replies}
          </div>`;
        })
        .join("\n")
    : `<p class="empty">No tweets returned.</p>`;

  return `<section class="page" data-page="2">
    ${pageHeader("Trending on X")}
    ${xData.error ? `<div class="notice"><strong>X API error:</strong> ${escapeHtml(xData.error)}</div>` : ""}
    <h3 class="section-rule">Trending Hashtags &amp; Topics</h3>
    ${trendsHtml}
    <h3 class="section-rule">Most Trending Posts</h3>
    ${tweetsHtml}
  </section>`;
}

// ---------------------------------------------------------------------------
// Page: fun / odd
// ---------------------------------------------------------------------------

function renderFunPage(funClusters) {
  const body = funClusters.length
    ? `<div class="tr-grid">${funClusters
        .map(
          (c) => `<div class="tr-card">
            <a class="tr-link" href="${escapeHtml(c.top_url || "#")}" target="_blank" rel="noopener">
              ${thumb(c.top_image, c.top_source, "tr-thumb", c.top_image_is_stock)}
              <div class="tr-title">${escapeHtml(c.representative_title || "")}</div>
              <div class="tr-meta">${escapeHtml(c.top_source || "")}${formatWhen(c.top_published_at) ? ` &middot; ${formatWhen(c.top_published_at)}` : ""}</div>
            </a>
            ${summaryControls(c.id)}
          </div>`
        )
        .join("\n")}</div>`
    : `<p class="empty">No odd news yet &mdash; the fun/odd feeds populate on the next ingest run.</p>`;

  return `<section class="page" data-page="3">
    ${pageHeader("Fun &amp; Odd")}
    <p class="page-kicker">The lighter side of the news cycle.</p>
    ${body}
  </section>`;
}

// ---------------------------------------------------------------------------
// Page: sports
// ---------------------------------------------------------------------------

function renderSportsPage(sports, sportsClusters) {
  const scoreRow = (g) => `<div class="score-row">
    <span class="score-league">${escapeHtml(g.league)}</span>
    <span class="score-teams">${escapeHtml(g.away.team)} <strong>${escapeHtml(g.away.score)}</strong> @ ${escapeHtml(g.home.team)} <strong>${escapeHtml(g.home.score)}</strong></span>
    <span class="score-status">${escapeHtml(g.statusText)}</span>
  </div>`;

  const upcomingRow = (g) => `<div class="score-row">
    <span class="score-league">${escapeHtml(g.league)}</span>
    <span class="score-teams">${escapeHtml(g.away.team)} @ ${escapeHtml(g.home.team)}</span>
    <span class="score-status">${escapeHtml(g.statusText)}</span>
  </div>`;

  const finals = sports?.finals?.length
    ? sports.finals.map(scoreRow).join("")
    : `<p class="empty">No completed games found for yesterday.</p>`;
  const upcoming = sports?.upcoming?.length
    ? sports.upcoming.map(upcomingRow).join("")
    : `<p class="empty">No upcoming games found.</p>`;

  const news = sportsClusters.length
    ? sportsClusters.map(headlineRow).join("\n")
    : `<p class="empty">No sports headlines yet.</p>`;

  return `<section class="page" data-page="4">
    ${pageHeader("Sports")}
    <h3 class="section-rule">Yesterday's Final Scores</h3>
    <div class="scoreboard">${finals}</div>
    <h3 class="section-rule">Upcoming &amp; In Progress</h3>
    <div class="scoreboard">${upcoming}</div>
    <h3 class="section-rule">Player News, Injuries &amp; Updates</h3>
    ${news}
  </section>`;
}

// ---------------------------------------------------------------------------
// Page: political slider (1-5)
// ---------------------------------------------------------------------------

function renderSliderPage(slider) {
  if (!slider) {
    return `<section class="page" data-page="5">
      ${pageHeader("The Political Slider")}
      <p class="empty">No event loaded yet &mdash; the slider populates on the next ingest run.</p>
    </section>`;
  }

  const buckets = [1, 2, 3, 4, 5]
    .map((lean) => {
      const items = slider.byLean[lean] || [];
      const body = items.length
        ? items
            .map(
              (a) => `<div class="slider-article">
                <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.title)}</a>
                <div class="slider-outlet">${escapeHtml(a.outlet || "")}${formatWhen(a.publishedAt) ? ` &middot; ${formatWhen(a.publishedAt)}` : ""}</div>
              </div>`
            )
            .join("")
        : `<p class="empty">No coverage from this side of the spectrum today.</p>`;
      return `<div class="slider-panel" data-lean="${lean}">
        <div class="slider-panel-head"><span class="slider-num">${lean}</span> ${escapeHtml(LEAN_LABELS[lean])}</div>
        ${body}
      </div>`;
    })
    .join("\n");

  return `<section class="page" data-page="5">
    ${pageHeader("The Political Slider")}
    <p class="page-kicker">One story, five vantage points. Slide to see how coverage shifts across the spectrum.</p>
    <div class="slider-event">${escapeHtml(slider.headline)}</div>

    <div class="slider-control">
      <input type="range" min="1" max="5" step="1" value="3" id="leanSlider" oninput="setLean(this.value)" />
      <div class="slider-ticks">
        <span>1<br/>Far Left</span><span>2<br/>Mod. Left</span><span>3<br/>Center</span><span>4<br/>Mod. Right</span><span>5<br/>Far Right</span>
      </div>
      <div class="slider-current" id="leanCurrent">Center</div>
    </div>

    <div class="slider-panels">${buckets}</div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Pages: remaining trending, by category
// ---------------------------------------------------------------------------

function renderCategoryPages(categorySections, startPage) {
  // Two categories per page keeps each spread readable rather than one
  // endless scroll of every section.
  const pages = [];
  const perPage = 2;
  for (let i = 0; i < categorySections.length; i += perPage) {
    const group = categorySections.slice(i, i + perPage);
    const pageNo = startPage + pages.length;
    const body = group
      .map(
        ({ label, clusters }) => `<div class="cat-block">
          <h3 class="section-rule">${escapeHtml(label)}</h3>
          ${clusters.length ? clusters.map(headlineRow).join("\n") : `<p class="empty">No stories yet in this section.</p>`}
        </div>`
      )
      .join("\n");
    pages.push(`<section class="page" data-page="${pageNo}">
      ${pageHeader("More Trending")}
      <div class="cat-grid">${body}</div>
    </section>`);
  }
  return pages;
}

function pageHeader(title) {
  return `<div class="page-head">
    <div class="page-head-brand">DirectioNews</div>
    <div class="page-head-title">${title}</div>
    <div class="page-head-date">${escapeHtml(editionDate())}</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Full document
// ---------------------------------------------------------------------------

export function renderNewspaper({
  breaking,
  trending,
  categorySections,
  funClusters,
  sportsClusters,
  sports,
  xData,
  slider,
  todaysSong,
  dailySummary,
  defaultTrackId,
}) {
  const trackId = todaysSong?.track_id || defaultTrackId;
  const storyCount =
    (breaking ? 1 : 0) +
    trending.length +
    funClusters.length +
    sportsClusters.length +
    categorySections.reduce((n, s) => n + s.clusters.length, 0);

  const catPages = renderCategoryPages(categorySections, 6);
  const pages = [
    renderCover(storyCount),
    renderFrontPage(breaking, trending, dailySummary),
    renderXPage(xData),
    renderFunPage(funClusters),
    renderSportsPage(sports, sportsClusters),
    renderSliderPage(slider),
    ...catPages,
  ];
  const totalPages = pages.length;

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
    --ink: #111;
    --paper: #f4f1e8;
    --paper-edge: #e8e3d5;
    --link: #111;
    --meta: #666;
    --rule: #111;
    --font: 'Times New Roman', Times, serif;
    --font-header: 'Roboto Condensed', Arial, Helvetica, sans-serif;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: var(--paper-edge);
    color: var(--ink);
    font-family: var(--font);
    font-size: 16px;
    line-height: 1.5;
    opacity: 0;
    transition: opacity 0.6s ease;
  }
  body.loaded { opacity: 1; }

  /* ---------- Reveal ---------- */
  .reveal { opacity: 0; transform: translateY(-24px); transition: opacity .7s ease, transform .7s ease; }
  .reveal.shown { opacity: 1; transform: none; }
  @media (prefers-reduced-motion: reduce) {
    body, .reveal { opacity: 1 !important; transform: none !important; transition: none !important; }
  }

  /* ---------- Side rails ---------- */
  .side-rail { position: fixed; top: 0; bottom: 0; width: 132px; pointer-events: none; z-index: 0; overflow: hidden; }
  .side-rail-left { left: 0; }
  .side-rail-right { right: 0; }
  .side-rail-panel {
    width: 100%; aspect-ratio: 320/569;
    background-image: url('/side-art.png'); background-size: contain; background-repeat: no-repeat;
    opacity: 0.13;
  }
  .side-rail-right .side-rail-panel { transform: scaleX(-1); }
  @media (max-width: 1450px) { .side-rail { display: none; } }

  /* ---------- Paper / pages ---------- */
  /* The paper is a 3D stage so pages can rotate about their spine rather
     than just cross-fading -- that hinge is what sells "turning a page"
     instead of "swapping a slide". */
  .paper {
    position: relative;
    max-width: 1080px;
    margin: 0 auto;
    padding: 0;
    z-index: 1;
    perspective: 2400px;
    perspective-origin: 50% 40%;
  }
  .page {
    display: none;
    background: var(--paper);
    min-height: 100vh;
    padding: 28px 40px 90px;
    box-shadow: 0 0 24px rgba(0,0,0,0.12);
    transform-style: preserve-3d;
    backface-visibility: hidden;
  }
  .page.active { display: block; }
  @media (max-width: 700px) { .page { padding: 20px 16px 90px; } }

  /* Forward: the outgoing page swings away on its left edge (spine) while
     the incoming one settles in. Backward mirrors it. */
  .page.flip-out-fwd { display: block; transform-origin: left center; animation: flipOutFwd .62s ease-in forwards; z-index: 3; position: relative; }
  .page.flip-in-fwd { animation: flipInFwd .62s ease-out both; }
  .page.flip-out-back { display: block; transform-origin: right center; animation: flipOutBack .62s ease-in forwards; z-index: 3; position: relative; }
  .page.flip-in-back { animation: flipInBack .62s ease-out both; }

  @keyframes flipOutFwd {
    0% { transform: rotateY(0deg); opacity: 1; box-shadow: 0 0 24px rgba(0,0,0,0.12); }
    100% { transform: rotateY(-88deg); opacity: 0; box-shadow: 28px 0 46px rgba(0,0,0,0.34); }
  }
  @keyframes flipInFwd {
    0% { transform: rotateY(70deg); transform-origin: left center; opacity: .2; }
    100% { transform: rotateY(0deg); transform-origin: left center; opacity: 1; }
  }
  @keyframes flipOutBack {
    0% { transform: rotateY(0deg); opacity: 1; box-shadow: 0 0 24px rgba(0,0,0,0.12); }
    100% { transform: rotateY(88deg); opacity: 0; box-shadow: -28px 0 46px rgba(0,0,0,0.34); }
  }
  @keyframes flipInBack {
    0% { transform: rotateY(-70deg); transform-origin: right center; opacity: .2; }
    100% { transform: rotateY(0deg); transform-origin: right center; opacity: 1; }
  }

  /* Corner curl: a triangle of "paper" peeling at the outer corner during
     the turn, shaded so it reads as a lifted sheet rather than a shape. */
  .page-corner {
    position: fixed;
    width: 190px; height: 190px;
    pointer-events: none;
    z-index: 6;
    opacity: 0;
  }
  .page-corner.curl-fwd {
    right: 0; bottom: 0;
    background: linear-gradient(225deg, var(--paper) 0%, #ded8c6 46%, #b9b2a0 62%, rgba(0,0,0,0.18) 76%, transparent 77%);
    box-shadow: -8px -8px 22px rgba(0,0,0,0.22);
    animation: curlFwd .62s ease-in-out;
  }
  .page-corner.curl-back {
    left: 0; bottom: 0;
    background: linear-gradient(135deg, var(--paper) 0%, #ded8c6 46%, #b9b2a0 62%, rgba(0,0,0,0.18) 76%, transparent 77%);
    box-shadow: 8px -8px 22px rgba(0,0,0,0.22);
    animation: curlBack .62s ease-in-out;
  }
  @keyframes curlFwd {
    0% { opacity: 0; transform: translate(78px, 78px) rotate(0deg); }
    38% { opacity: 1; transform: translate(0, 0) rotate(-9deg); }
    100% { opacity: 0; transform: translate(-190px, -34px) rotate(-30deg); }
  }
  @keyframes curlBack {
    0% { opacity: 0; transform: translate(-78px, 78px) rotate(0deg); }
    38% { opacity: 1; transform: translate(0, 0) rotate(9deg); }
    100% { opacity: 0; transform: translate(190px, -34px) rotate(30deg); }
  }

  /* Honour the OS "reduce motion" setting by default -- but scope it to
     :not(.anim-on) so the reader can opt back in with the nav toggle.
     Windows in particular ships with animation effects off for many
     users, which would otherwise silently kill the page turn with no
     way to get it back. */
  @media (prefers-reduced-motion: reduce) {
    body:not(.anim-on) .page.flip-out-fwd,
    body:not(.anim-on) .page.flip-in-fwd,
    body:not(.anim-on) .page.flip-out-back,
    body:not(.anim-on) .page.flip-in-back { animation: none; }
    body:not(.anim-on) .page.flip-out-fwd,
    body:not(.anim-on) .page.flip-out-back { display: none; }
    body:not(.anim-on) .page-corner { display: none; }
    body:not(.anim-on) .breaking-banner::after { animation: none; }
    body:not(.anim-on) .breaking-banner-text { animation: none; }
  }
  .anim-toggle {
    background: none; border: 1px solid var(--paper); color: var(--paper);
    font-family: var(--font-header); font-size: 11px; letter-spacing: 1px;
    padding: 4px 10px; cursor: pointer; opacity: .8;
  }
  .anim-toggle:hover { background: var(--paper); color: var(--ink); opacity: 1; }
  @media (max-width: 700px) { .anim-toggle { display: none; } }

  /* ---------- Cover ---------- */
  .page-cover { display: none; text-align: center; }
  .page-cover.active { display: flex; align-items: center; justify-content: center; }
  .cover-inner { width: 100%; max-width: 760px; }
  .cover-rule { border-top: 3px double var(--rule); margin: 10px 0; }
  .cover-masthead {
    font-family: var(--font-header);
    font-weight: 900;
    font-size: clamp(44px, 10vw, 104px);
    line-height: 1;
    margin: 12px 0;
    letter-spacing: 1px;
  }
  .cover-date { font-size: 17px; letter-spacing: 2px; text-transform: uppercase; margin-top: 14px; }
  .cover-tagline { font-family: var(--font-header); font-size: 15px; letter-spacing: 4px; text-transform: uppercase; color: var(--meta); margin-top: 6px; }
  .cover-count { font-size: 14px; color: var(--meta); margin-top: 26px; font-style: italic; }
  .cover-cta {
    margin-top: 30px;
    font-family: var(--font);
    font-size: 20px;
    padding: 14px 30px;
    background: var(--ink);
    color: var(--paper);
    border: none;
    cursor: pointer;
    letter-spacing: 1px;
  }
  .cover-cta:hover { background: #333; }
  .cover-arrow { display: inline-block; margin-left: 10px; transition: transform .25s ease; }
  .cover-cta:hover .cover-arrow { transform: translateX(6px); }

  /* ---------- Page furniture ---------- */
  .page-head {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 12px; flex-wrap: wrap;
    border-bottom: 3px double var(--rule); padding-bottom: 8px; margin-bottom: 18px;
  }
  .page-head-brand { font-family: var(--font-header); font-weight: 900; font-size: 22px; }
  .page-head-title { font-size: 20px; font-style: italic; }
  .page-head-date { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: var(--meta); }
  .page-kicker { font-style: italic; color: var(--meta); margin: 0 0 18px; }
  .section-rule {
    font-family: var(--font-header);
    font-size: 14px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase;
    border-bottom: 1px solid var(--rule); padding-bottom: 4px; margin: 26px 0 14px;
  }

  /* ---------- Breaking ---------- */
  .breaking { border: 3px solid var(--ink); padding: 0 0 18px; margin-bottom: 18px; background: #fffdf7; }
  .breaking-banner {
    background: #c1121f;
    color: #fff;
    text-align: center;
    padding: 10px 12px;
    margin-bottom: 16px;
    overflow: hidden;
    position: relative;
  }
  /* Slow sheen sweeping across the banner -- draws the eye without the
     jitter of a flash or blink, which gets annoying fast on a page you
     sit with. */
  .breaking-banner::after {
    content: "";
    position: absolute; top: 0; bottom: 0; left: -60%;
    width: 45%;
    background: linear-gradient(100deg, transparent, rgba(255,255,255,0.38), transparent);
    animation: sheen 4.5s ease-in-out infinite;
  }
  @keyframes sheen { 0% { left: -60%; } 55%, 100% { left: 130%; } }
  .breaking-banner-text {
    font-family: var(--font-header);
    font-weight: 900;
    font-size: clamp(30px, 6.5vw, 62px);
    letter-spacing: clamp(3px, 1.2vw, 12px);
    text-transform: uppercase;
    line-height: 1.05;
    display: inline-block;
    text-shadow: 2px 2px 0 rgba(0,0,0,0.35);
    animation: boom 0.75s cubic-bezier(.2,1.5,.4,1) both;
  }
  @keyframes boom {
    0% { transform: scale(.55); opacity: 0; }
    70% { transform: scale(1.06); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .breaking-banner::after { animation: none; }
    .breaking-banner-text { animation: none; }
  }
  .breaking-link, .breaking-meta, .breaking .summary-controls { padding: 0 18px; }
  .breaking-link { display: block; }
  .breaking-link { text-decoration: none; color: inherit; display: block; }
  .breaking-thumb { width: 100%; max-height: 320px; aspect-ratio: 16/7; overflow: hidden; border: 1px solid #ccc; margin-bottom: 12px; }
  .breaking-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .breaking-title { font-size: clamp(26px, 4vw, 42px); line-height: 1.12; margin: 0; font-weight: 700; }
  .breaking-meta { font-size: 12px; color: var(--meta); margin-top: 8px; }

  /* ---------- Trending grid ---------- */
  .tr-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; }
  @media (max-width: 900px) { .tr-grid { grid-template-columns: repeat(2, 1fr); } }
  .tr-card { display: flex; flex-direction: column; }
  .tr-link { text-decoration: none; color: inherit; }
  .tr-thumb { width: 100%; aspect-ratio: 16/10; overflow: hidden; background: #e8e3d5; border: 1px solid #ccc; }
  .tr-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .tr-title { font-weight: 700; font-size: 14px; margin-top: 6px; line-height: 1.25; }
  .tr-meta { font-size: 11px; color: var(--meta); }
  .thumb-placeholder {
    width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 700; text-align: center; padding: 6px; color: #444;
  }
  /* Marks a keyword-matched CC image so it isn't mistaken for a photo of
     the actual event. */
  .tr-thumb, .breaking-thumb { position: relative; }
  .stock-tag {
    position: absolute; right: 0; bottom: 0;
    background: rgba(0,0,0,0.62); color: #fff;
    font-family: var(--font-header); font-size: 9px; letter-spacing: 1px;
    text-transform: uppercase; padding: 1px 5px;
  }

  /* ---------- Headlines ---------- */
  .headline { margin-bottom: 14px; }
  .headline a { color: var(--link); font-weight: 700; text-decoration: none; font-size: 15px; }
  .headline a:hover { text-decoration: underline; }
  .meta { color: var(--meta); font-size: 11px; margin-left: 6px; }
  .empty { color: var(--meta); font-size: 13px; font-style: italic; }

  /* ---------- Buttons ---------- */
  .summarize-btn, .play-btn, .close-btn {
    font-family: var(--font); font-size: 11px; padding: 3px 9px;
    border: 1px solid #999; background: #fff; cursor: pointer; margin-right: 4px; margin-top: 4px;
  }
  .summarize-btn:hover, .play-btn:hover, .close-btn:hover { background: #eee; }
  .summarize-btn:disabled { opacity: .6; cursor: default; }
  .summary-text { font-size: 12px; color: #333; margin: 6px 0; line-height: 1.45; }
  .big-btn {
    font-family: var(--font); font-size: 15px; padding: 9px 18px;
    border: 1px solid var(--ink); background: var(--ink); color: var(--paper); cursor: pointer; margin-right: 8px;
  }
  .big-btn:hover { background: #333; }
  .big-btn:disabled { opacity: .6; cursor: default; }
  .front-actions { margin-bottom: 12px; }
  .front-summary { font-size: 14px; line-height: 1.6; white-space: pre-wrap; margin-bottom: 16px; }

  /* ---------- X page ---------- */
  .notice { border: 1px solid #bbb; background: #fffdf7; padding: 16px 18px; font-size: 14px; line-height: 1.6; }
  .notice p { margin: 0 0 10px; }
  .notice-small { font-size: 12px; color: var(--meta); }
  .x-tags { display: flex; flex-wrap: wrap; gap: 8px; }
  .x-tag { border: 1px solid #999; padding: 5px 10px; font-size: 13px; font-family: var(--font-header); }
  .x-tag em { display: block; font-size: 10px; color: var(--meta); font-style: normal; }
  .x-tweet { border-top: 1px solid #ddd; padding: 14px 0; }
  .x-tweet-author { font-weight: 700; font-size: 14px; }
  .x-tweet-author span { font-weight: 400; color: var(--meta); }
  .x-tweet-text { margin: 6px 0; font-size: 15px; }
  .x-tweet-meta { font-size: 11px; color: var(--meta); }
  .x-badge { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; border: 1px solid #999; padding: 1px 5px; }
  .x-badge-business { background: #fff3cd; }
  .x-badge-government { background: #e2e3e5; }
  .x-replies { margin-top: 10px; padding-left: 14px; border-left: 2px solid #ddd; }
  .x-replies-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--meta); margin-bottom: 6px; }
  .x-reply { margin-bottom: 8px; }
  .x-reply-author { font-size: 12px; font-weight: 700; }
  .x-reply-author span { font-weight: 400; color: var(--meta); }
  .x-reply-text { font-size: 13px; }

  /* ---------- Sports ---------- */
  .scoreboard { border-top: 1px solid #ddd; }
  .score-row {
    display: grid; grid-template-columns: 64px 1fr auto; gap: 10px; align-items: center;
    border-bottom: 1px solid #eee; padding: 7px 0; font-size: 14px;
  }
  .score-league { font-family: var(--font-header); font-size: 11px; letter-spacing: 1px; color: var(--meta); }
  .score-status { font-size: 11px; color: var(--meta); text-align: right; }

  /* ---------- Political slider ---------- */
  .slider-event { font-size: 20px; font-weight: 700; line-height: 1.25; margin-bottom: 18px; border-left: 4px solid var(--ink); padding-left: 12px; }
  .slider-control { margin: 20px 0 26px; }
  #leanSlider { width: 100%; }
  .slider-ticks { display: flex; justify-content: space-between; font-size: 11px; text-align: center; color: var(--meta); margin-top: 4px; }
  .slider-ticks span { flex: 1; }
  .slider-current { text-align: center; font-family: var(--font-header); font-size: 18px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; margin-top: 10px; }
  .slider-panel { display: none; }
  .slider-panel.active { display: block; }
  .slider-panel-head { font-family: var(--font-header); font-size: 15px; letter-spacing: 2px; text-transform: uppercase; border-bottom: 1px solid var(--rule); padding-bottom: 5px; margin-bottom: 12px; }
  .slider-num { display: inline-block; background: var(--ink); color: var(--paper); width: 22px; height: 22px; line-height: 22px; text-align: center; margin-right: 6px; }
  .slider-article { margin-bottom: 12px; }
  .slider-article a { color: var(--link); font-weight: 700; text-decoration: none; font-size: 15px; }
  .slider-article a:hover { text-decoration: underline; }
  .slider-outlet { font-size: 11px; color: var(--meta); }

  /* ---------- Category pages ---------- */
  .cat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 26px; }
  @media (max-width: 700px) { .cat-grid { grid-template-columns: 1fr; } }

  /* ---------- Today's summary ---------- */
  .daily-summary-widget { border: 1px solid #ccc; background: #fffdf7; padding: 12px 16px; margin-bottom: 16px; }
  .daily-summary-widget summary { font-family: var(--font-header); font-size: 14px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; cursor: pointer; }
  .daily-summary-text { font-size: 14px; white-space: pre-wrap; margin: 12px 0; }

  /* ---------- Nav ---------- */
  .nav-bar {
    position: fixed; bottom: 0; left: 0; right: 0; z-index: 5;
    display: flex; align-items: center; justify-content: center; gap: 16px;
    background: var(--ink); color: var(--paper); padding: 9px 14px;
    font-family: var(--font-header); font-size: 13px; letter-spacing: 1px;
  }
  .nav-btn { background: none; border: 1px solid var(--paper); color: var(--paper); font-family: var(--font-header); font-size: 13px; padding: 5px 14px; cursor: pointer; }
  .nav-btn:hover:not(:disabled) { background: var(--paper); color: var(--ink); }
  .nav-btn:disabled { opacity: .35; cursor: default; }
  .nav-pages { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
  .nav-page { background: none; border: none; color: var(--paper); font-family: var(--font-header); font-size: 12px; cursor: pointer; padding: 3px 7px; opacity: .65; }
  .nav-page.current { opacity: 1; text-decoration: underline; }
  @media (max-width: 700px) { .nav-pages { display: none; } }
  .song-widget { position: fixed; right: 14px; bottom: 52px; z-index: 5; }
  @media (max-width: 900px) { .song-widget { display: none; } }
</style>
</head>
<body>
  <div class="side-rail side-rail-left" id="sideRailLeft" aria-hidden="true"></div>
  <div class="side-rail side-rail-right" id="sideRailRight" aria-hidden="true"></div>

  <div class="paper" id="paper">
    ${pages.join("\n")}
  </div>

  <div class="song-widget">
    <iframe src="https://open.spotify.com/embed/track/${trackId}?utm_source=generator"
      width="260" height="80" frameborder="0"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>
  </div>

  <nav class="nav-bar">
    <button type="button" class="nav-btn" id="prevBtn" onclick="prevPage()">&larr; Prev</button>
    <div class="nav-pages" id="navPages"></div>
    <button type="button" class="nav-btn" id="nextBtn" onclick="nextPage()">Next &rarr;</button>
    <button type="button" class="anim-toggle" id="animToggle" onclick="toggleAnimation()"></button>
  </nav>

  <script>
    var TOTAL_PAGES = ${totalPages};
    var PAGE_NAMES = ${JSON.stringify(["Cover", "Front", "X", "Fun", "Sports", "Slider"].concat(catPages.map((_, i) => "More " + (i + 1))))};
    var currentPage = 0;

    var FLIP_MS = 620;
    var flipping = false;

    // Animation preference resolves in this order: an explicit choice the
    // reader made via the nav toggle (persisted), otherwise the OS
    // "reduce motion" setting. Read live rather than snapshotted once, so
    // flipping the toggle takes effect on the very next page turn.
    var ANIM_KEY = "directionews-animate";
    function animOverride() {
      try { return localStorage.getItem(ANIM_KEY); } catch (e) { return null; }
    }
    function osPrefersReduced() {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }
    function animationsEnabled() {
      var pref = animOverride();
      if (pref === "on") return true;
      if (pref === "off") return false;
      return !osPrefersReduced();
    }
    function applyAnimPreference() {
      var on = animationsEnabled();
      document.body.classList.toggle("anim-on", on);
      var btn = document.getElementById("animToggle");
      if (btn) {
        btn.textContent = on ? "Page turn: On" : "Page turn: Off";
        btn.setAttribute("aria-pressed", String(on));
      }
    }
    function toggleAnimation() {
      var next = animationsEnabled() ? "off" : "on";
      try { localStorage.setItem(ANIM_KEY, next); } catch (e) {}
      applyAnimPreference();
    }

    function pageEl(n) { return document.querySelector('.page[data-page="' + n + '"]'); }

    function finishNav(n) {
      currentPage = n;
      document.getElementById("prevBtn").disabled = n === 0;
      document.getElementById("nextBtn").disabled = n === TOTAL_PAGES - 1;
      document.querySelectorAll(".nav-page").forEach(function (b) {
        b.classList.toggle("current", Number(b.dataset.page) === n);
      });
      window.scrollTo(0, 0);
      if (history.replaceState) history.replaceState(null, "", "#page-" + n);
      revealVisible();
    }

    // Animates the turn: the outgoing sheet swings on its spine, the
    // incoming one settles in behind it, and a shaded corner peels across
    // in the same direction. The flipping guard stops rapid clicks or a
    // held arrow key overlapping two turns and stranding a page mid-rotation.
    function goToPage(n, opts) {
      opts = opts || {};
      if (n < 0 || n >= TOTAL_PAGES) return;
      if (flipping) return;

      var from = pageEl(currentPage);
      var to = pageEl(n);
      if (!to) return;

      if (!animationsEnabled() || opts.instant || n === currentPage || !from) {
        document.querySelectorAll(".page").forEach(function (p) {
          p.classList.remove("active", "flip-out-fwd", "flip-in-fwd", "flip-out-back", "flip-in-back");
        });
        to.classList.add("active");
        finishNav(n);
        return;
      }

      var forward = n > currentPage;
      flipping = true;

      var corner = document.createElement("div");
      corner.className = "page-corner " + (forward ? "curl-fwd" : "curl-back");
      document.body.appendChild(corner);

      from.classList.add(forward ? "flip-out-fwd" : "flip-out-back");
      to.classList.add("active", forward ? "flip-in-fwd" : "flip-in-back");
      finishNav(n);

      setTimeout(function () {
        from.classList.remove("active", "flip-out-fwd", "flip-out-back");
        to.classList.remove("flip-in-fwd", "flip-in-back");
        if (corner.parentNode) corner.parentNode.removeChild(corner);
        flipping = false;
      }, FLIP_MS);
    }
    function nextPage() { goToPage(currentPage + 1); }
    function prevPage() { goToPage(currentPage - 1); }

    document.addEventListener("keydown", function (e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "ArrowRight") nextPage();
      if (e.key === "ArrowLeft") prevPage();
    });

    // Some outlet CDNs (Variety, Deadline) hotlink-block cross-site <img>
    // requests even though the URL is valid. Swap in the same placeholder
    // used when there was never an image, rather than a broken icon.
    function handleImgError(img) {
      var box = img.parentElement;
      var div = document.createElement("div");
      div.className = "thumb-placeholder";
      div.style.background = box.dataset.fallbackColor;
      var span = document.createElement("span");
      span.textContent = box.dataset.fallbackLabel;
      div.appendChild(span);
      box.innerHTML = "";
      box.appendChild(div);
    }

    async function loadSummary(btn) {
      var id = btn.dataset.clusterId;
      btn.disabled = true; btn.textContent = "Loading...";
      try {
        var res = await fetch("/api/summary/" + id);
        var data = await res.json();
        document.getElementById("summary-" + id).textContent = data.summary || "No summary available.";
        if (data.summary) {
          btn.style.display = "none";
          var p = document.querySelector('.play-btn[data-cluster-id="' + id + '"]');
          if (p) p.style.display = "inline-block";
          var c = document.querySelector('.close-btn[data-cluster-id="' + id + '"]');
          if (c) c.style.display = "inline-block";
        } else { btn.disabled = false; btn.textContent = "Summarize"; }
      } catch (err) {
        btn.disabled = false; btn.textContent = "Summarize";
        document.getElementById("summary-" + id).textContent = "Could not load summary.";
      }
    }
    function playSummaryAudio(btn) { new Audio("/api/summary/" + btn.dataset.clusterId + "/audio").play(); }
    function closeSummary(btn) {
      var id = btn.dataset.clusterId;
      document.getElementById("summary-" + id).textContent = "";
      btn.style.display = "none";
      var p = document.querySelector('.play-btn[data-cluster-id="' + id + '"]');
      if (p) p.style.display = "none";
      var s = document.querySelector('.summarize-btn[data-cluster-id="' + id + '"]');
      if (s) { s.style.display = "inline-block"; s.disabled = false; s.textContent = "Summarize"; }
    }

    async function summarizeFrontPage() {
      var btn = document.getElementById("summarizeAllBtn");
      var out = document.getElementById("frontSummary");
      btn.disabled = true; btn.textContent = "Summarizing...";
      out.textContent = "";
      try {
        var res = await fetch("/api/front-summary");
        var data = await res.json();
        out.textContent = data.summary || "No summary available.";
        if (data.summary) {
          btn.style.display = "none";
          document.getElementById("frontAudioBtn").style.display = "inline-block";
          document.getElementById("frontCloseBtn").style.display = "inline-block";
        } else { btn.disabled = false; btn.textContent = "Summarize All"; }
      } catch (err) {
        out.textContent = "Could not load summary.";
        btn.disabled = false; btn.textContent = "Summarize All";
      }
    }
    function playFrontAudio() { new Audio("/api/front-summary/audio").play(); }
    function closeFrontSummary() {
      document.getElementById("frontSummary").textContent = "";
      document.getElementById("frontAudioBtn").style.display = "none";
      document.getElementById("frontCloseBtn").style.display = "none";
      var b = document.getElementById("summarizeAllBtn");
      b.style.display = "inline-block"; b.disabled = false; b.textContent = "Summarize All";
    }
    function playDailySummaryAudio() { new Audio("/api/daily-summary/audio").play(); }

    var LEAN_NAMES = { 1: "Far Left", 2: "Moderate Left", 3: "Center", 4: "Moderate Right", 5: "Far Right" };
    function setLean(v) {
      document.querySelectorAll(".slider-panel").forEach(function (p) {
        p.classList.toggle("active", p.dataset.lean === String(v));
      });
      var label = document.getElementById("leanCurrent");
      if (label) label.textContent = LEAN_NAMES[v];
    }

    function buildRails() {
      var h = window.innerHeight;
      var count = Math.ceil(h / (132 * (569 / 320))) + 1;
      ["sideRailLeft", "sideRailRight"].forEach(function (id) {
        var rail = document.getElementById(id);
        if (!rail) return;
        rail.innerHTML = "";
        for (var i = 0; i < count; i++) {
          var p = document.createElement("div");
          p.className = "side-rail-panel";
          rail.appendChild(p);
        }
      });
    }

    // Reveal anything already on screen for the active page. Elements stay
    // shown once revealed -- they're unobserved on first intersect.
    var io = null;
    function revealVisible() {
      if (!("IntersectionObserver" in window)) {
        document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("shown"); });
        return;
      }
      if (!io) {
        io = new IntersectionObserver(function (entries) {
          entries.forEach(function (e) {
            if (!e.isIntersecting) return;
            e.target.classList.add("shown");
            io.unobserve(e.target);
          });
        }, { threshold: 0.06, rootMargin: "0px 0px -30px 0px" });
      }
      document.querySelectorAll(".page.active .reveal:not(.shown)").forEach(function (el) { io.observe(el); });
    }

    function buildNav() {
      var wrap = document.getElementById("navPages");
      wrap.innerHTML = "";
      for (var i = 0; i < TOTAL_PAGES; i++) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "nav-page";
        b.dataset.page = i;
        b.textContent = PAGE_NAMES[i] || String(i);
        b.onclick = (function (n) { return function () { goToPage(n); }; })(i);
        wrap.appendChild(b);
      }
    }

    window.addEventListener("load", function () {
      document.body.classList.add("loaded");
      applyAnimPreference();
      buildRails();
      buildNav();
      setLean(3);
      var hash = /^#page-(\\d+)$/.exec(window.location.hash);
      goToPage(hash ? Math.min(Number(hash[1]), TOTAL_PAGES - 1) : 0, { instant: true });
    });
    var rt;
    window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(buildRails, 200); });
  </script>
</body>
</html>`;
}
