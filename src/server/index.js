import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { getTrendingClusters, getTrendingClustersPriority } from "../ranking/trending.js";
import { getSliderData } from "../ranking/politicalSlider.js";
import { getLightheartedClusters } from "../ranking/lighthearted.js";
import { getOrGenerateClusterSummary } from "../ai/summaries.js";
import { getOrSynthesizeAudio } from "../ai/audioCache.js";
import { generateText } from "../ai/claude.js";
import {
  getTodaysSummary,
  getTodaysSummaryAudio,
  generateAiDailySummary,
  generateAiDailySummaryAudio,
  setUserDailySummary,
} from "../ai/dailySummary.js";
import { backfillImagesForClusters } from "../ingestion/backfillImages.js";
import { backfillKeywordImages } from "../ingestion/keywordImage.js";
import { getSportsBundle } from "../ingestion/sports.js";
import { getXBundle } from "../ingestion/xTrends.js";
import { CATEGORIES } from "../config/categories.js";
import { renderNewspaper, escapeHtml, formatWhen } from "./newspaper.js";

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: false }));
// Static assets. Long cache: contents are stable.
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public");
app.use(express.static(PUBLIC_DIR, { maxAge: "7d" }));
// Memory storage (not disk) since the recording goes straight into Postgres
// as BYTEA -- Railway's filesystem is ephemeral anyway. 25MB caps a
// several-minute voice recording; this route is ADMIN_KEY-gated regardless.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "";

// Priority order for choosing the lead story + filling the Top 10: each
// tier's top trending stories fill what's left, then the next tier does.
// `category: null` is an overall-trending catch-all.
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

// Minimal headline list, used only by the /section/:category fallback page.
function renderHeadlineList(clusters) {
  if (clusters.length === 0) return `<p class="empty">No stories yet in this section.</p>`;
  return clusters
    .map((c) => {
      const when = formatWhen(c.top_published_at);
      const count = Number(c.source_count) || 1;
      return `<div class="headline">
        <a href="${escapeHtml(c.top_url || "#")}" target="_blank" rel="noopener">${escapeHtml((c.representative_title || "").toUpperCase())}</a>
        <span class="meta">(${escapeHtml(c.top_source || "")}${count > 1 ? ` +${count - 1} more` : ""}${when ? ` &middot; ${when}` : ""})</span>
      </div>`;
    })
    .join("\n");
}


// --- Routes ---------------------------------------------------------------

app.get("/", async (req, res) => {
  try {
    const [breakingAndTrending, dailySummary, funClusters, sportsClusters, sports, xData, slider, ...categoryClusters] =
      await Promise.all([
        getTrendingClustersPriority({ tiers: HERO_TIERS, limit: 11 }),
        getTodaysSummary(),
        getLightheartedClusters({ limit: 10 }),
        getTrendingClusters({ category: "sports", limit: 10 }),
        getSportsBundle(),
        getXBundle(),
        getSliderData(),
        ...CATEGORIES.map((cat) => getTrendingClusters({ category: cat.slug, limit: 10 })),
      ]);

    // Slot 1 is the day's lead story; the rest fill the Top 10 grid.
    const breaking = breakingAndTrending[0] || null;
    const trending = breakingAndTrending.slice(1, 11);

    // Every story that renders a thumbnail box gets something in it. First
    // pass scrapes the publisher's own og:image; whatever is still empty
    // falls back to a CC-licensed keyword image, flagged as stock so the
    // UI can label it. Both persist, so a story pays this at most once.
    const withThumbs = [breaking, ...trending, ...funClusters].filter(Boolean);
    await backfillImagesForClusters(withThumbs);
    await backfillKeywordImages(withThumbs);

    // Fun/Odd and Sports get dedicated pages, so drop them from the
    // "More Trending" spread to avoid printing the same story twice.
    const categorySections = CATEGORIES.map((cat, i) => ({ label: cat.label, clusters: categoryClusters[i] })).filter(
      (s) => s.clusters.length > 0 && s.label !== "Fun / Odd News" && s.label !== "Sports"
    );

    res.send(
      renderNewspaper({
        breaking, trending, categorySections, funClusters, sportsClusters,
        sports, xData, slider, dailySummary,
      })
    );
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

// "Summarize All" on the front page: one synthesis of the lead story plus
// the Top 10. Cached in-process for 30 minutes and keyed by the exact
// headline set, so repeat clicks (and multiple readers) don't each pay a
// Claude call, but the summary still refreshes when the front page does.
let frontSummaryCache = { key: null, text: null, expiresAt: 0 };

async function getFrontPageSummary() {
  const clusters = await getTrendingClustersPriority({ tiers: HERO_TIERS, limit: 11 });
  if (clusters.length === 0) return null;

  const key = clusters.map((c) => c.id).join(",");
  if (frontSummaryCache.key === key && frontSummaryCache.expiresAt > Date.now()) {
    return frontSummaryCache.text;
  }

  const lines = clusters.map((c, i) => `${i === 0 ? "[LEAD]" : "-"} ${c.representative_title} (${c.top_source})`).join("\n");
  const text = await generateText({
    system:
      "You brief a reader on today's front page using ONLY headlines and outlet names -- you do not have article text. Open with the lead story, then group the rest by theme. Plain prose, no markdown, no bullets, no asterisks (this is displayed as plain text and read aloud by text-to-speech). 200-350 words, neutral tone.",
    prompt: `Today's front page:\n${lines}\n\nWrite the briefing.`,
    maxTokens: 700,
  });

  frontSummaryCache = { key, text, expiresAt: Date.now() + 30 * 60 * 1000 };
  return text;
}

app.get("/api/front-summary", async (req, res) => {
  try {
    const summary = await getFrontPageSummary();
    res.json({ summary });
  } catch (err) {
    console.error("[api/front-summary] error:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

app.get("/api/front-summary/audio", async (req, res) => {
  try {
    const summary = await getFrontPageSummary();
    if (!summary) return res.status(404).send("No summary available");
    const { audio_data, content_type } = await getOrSynthesizeAudio(summary);
    res.set("Content-Type", content_type).send(audio_data);
  } catch (err) {
    console.error("[api/front-summary/audio] error:", err);
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

// --- Admin gate ------------------------------------------------------
// Lightweight shared-secret check (no login system) -- set ADMIN_KEY in
// .env and append ?key=YOUR_KEY. Fine for a low-stakes internal tool;
// do not share the URL publicly.

function requireAdminKey(req, res, next) {
  if (!ADMIN_KEY || req.query.key !== ADMIN_KEY) {
    return res.status(403).send("Forbidden — missing or incorrect ?key=");
  }
  next();
}

// --- Admin: today's summary --------------------------------------------
// Same shared-secret gate as the admin gate above. Either generate an AI summary
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
