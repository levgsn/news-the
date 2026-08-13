import { pool } from "../db/client.js";
import { generateText } from "../ai/claude.js";
import { fetchGNews } from "../ingestion/gnewsClient.js";
import { getTrendingClustersPriority } from "./trending.js";
import { OUTLET_LEANS } from "../config/outletLeans.js";

// GNews free tier paces poorly under bursts; a short gap between the
// slider's handful of daily requests keeps it well clear of 429s.
const REQUEST_SPACING_MS = 2500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseJson(raw) {
  const cleaned = raw.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/**
 * Resolves each outlet name to a 1-5 lean: hand-curated map first
 * (config/outletLeans.js), then the DB cache of past Claude calls, and
 * only genuinely-new outlets go to Claude -- classified once in a single
 * batched call, then cached forever.
 */
async function classifyOutlets(outlets) {
  const result = new Map();
  const unknown = [];

  for (const outlet of outlets) {
    if (OUTLET_LEANS[outlet] !== undefined) result.set(outlet, OUTLET_LEANS[outlet]);
    else unknown.push(outlet);
  }

  if (unknown.length > 0) {
    const { rows } = await pool.query(`SELECT outlet, lean FROM outlet_lean_cache WHERE outlet = ANY($1)`, [unknown]);
    for (const row of rows) result.set(row.outlet, row.lean);
  }

  const stillUnknown = unknown.filter((o) => !result.has(o));
  if (stillUnknown.length > 0) {
    try {
      const raw = await generateText({
        system:
          "You classify news outlets by political lean on a 1-5 scale: 1 far left, 2 moderate left, 3 center, 4 moderate right, 5 far right. Use general media-bias consensus (AllSides/Ad Fontes style). If an outlet is obscure or apolitical (local TV, sports, entertainment trade press), use 3. Respond with ONLY a JSON object mapping each outlet name to an integer 1-5, no markdown.",
        prompt: `Classify these outlets: ${JSON.stringify(stillUnknown)}`,
        maxTokens: 400,
      });
      const parsed = parseJson(raw);
      if (parsed && typeof parsed === "object") {
        for (const outlet of stillUnknown) {
          const lean = Number(parsed[outlet]);
          const valid = Number.isInteger(lean) && lean >= 1 && lean <= 5 ? lean : 3;
          result.set(outlet, valid);
          await pool.query(
            `INSERT INTO outlet_lean_cache (outlet, lean) VALUES ($1, $2) ON CONFLICT (outlet) DO NOTHING`,
            [outlet, valid]
          );
        }
      }
    } catch (err) {
      console.error(`[slider] outlet classification failed: ${err.message}`);
    }
  }

  // Anything still unresolved (Claude failed) defaults to center rather
  // than being dropped -- but is NOT cached, so it gets retried next run.
  for (const outlet of outlets) {
    if (!result.has(outlet)) result.set(outlet, 3);
  }
  return result;
}

/**
 * Once-daily job (wired into `npm run ingest`): picks the day's top
 * political story, asks Claude for a short search query for it, pulls
 * coverage of that same event from GNews, buckets every result by outlet
 * lean 1-5, and stores the lot. Skips itself if today's event already
 * exists. Costs ~3 GNews requests + 1-2 Claude calls per day.
 */
export async function refreshSliderEvent() {
  const { rows: existing } = await pool.query(`SELECT id FROM slider_events WHERE event_date = CURRENT_DATE`);
  if (existing.length > 0) return { skipped: true };

  const top = await getTrendingClustersPriority({
    tiers: [{ category: "us_politics" }, { category: "world_geopolitics" }, { category: null }],
    limit: 1,
  });
  if (top.length === 0) return { skipped: true, reason: "no trending story" };
  const headline = top[0].representative_title;

  let query = null;
  try {
    const raw = await generateText({
      system:
        "Given a news headline, produce a 2-4 word news-search query capturing the specific EVENT (names, places, bills -- not generic topics), so a search finds other outlets' coverage of that same story. Respond with ONLY the query text, nothing else.",
      prompt: headline,
      maxTokens: 30,
    });
    query = raw.trim().replace(/^["']|["']$/g, "").slice(0, 80);
  } catch (err) {
    console.error(`[slider] query generation failed: ${err.message}`);
    // Crude fallback: first few meaningful words of the headline.
    query = headline.split(/\s+/).slice(0, 4).join(" ");
  }

  // Two searches widen outlet variety: straight coverage plus opinion/reaction.
  const seen = new Set();
  const articles = [];
  for (const term of [query, `${query} reaction`]) {
    const batch = await fetchGNews(term, 10);
    for (const a of batch) {
      if (!a.title || !a.url || seen.has(a.url)) continue;
      seen.add(a.url);
      articles.push(a);
    }
    await sleep(REQUEST_SPACING_MS);
  }
  if (articles.length === 0) return { skipped: true, reason: "no coverage found" };

  const outlets = [...new Set(articles.map((a) => a.source?.name || "Unknown"))];
  const leans = await classifyOutlets(outlets);

  const { rows: ev } = await pool.query(
    `INSERT INTO slider_events (event_date, headline, query) VALUES (CURRENT_DATE, $1, $2)
     ON CONFLICT (event_date) DO UPDATE SET headline = EXCLUDED.headline, query = EXCLUDED.query
     RETURNING id`,
    [headline, query]
  );
  const eventId = ev[0].id;

  let inserted = 0;
  for (const a of articles) {
    const outlet = a.source?.name || "Unknown";
    const { rowCount } = await pool.query(
      `INSERT INTO slider_articles (event_id, lean, title, url, outlet, image_url, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (event_id, url) DO NOTHING`,
      [eventId, leans.get(outlet), a.title, a.url, outlet, a.image || null, a.publishedAt || null]
    );
    inserted += rowCount;
  }

  return { skipped: false, headline, query, articles: inserted };
}

/**
 * Latest slider event with its articles grouped by lean 1-5, for the
 * newspaper's Political Slider page. Falls back to the most recent event
 * with data if today's hasn't been generated yet.
 */
export async function getSliderData() {
  const { rows: events } = await pool.query(
    `SELECT id, event_date, headline FROM slider_events ORDER BY event_date DESC LIMIT 1`
  );
  if (events.length === 0) return null;
  const event = events[0];

  const { rows } = await pool.query(
    `SELECT lean, title, url, outlet, image_url AS image, published_at AS "publishedAt"
     FROM slider_articles WHERE event_id = $1 ORDER BY lean, published_at DESC NULLS LAST`,
    [event.id]
  );

  const byLean = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const row of rows) {
    if (byLean[row.lean]) byLean[row.lean].push(row);
  }
  return { headline: event.headline, eventDate: event.event_date, byLean };
}
