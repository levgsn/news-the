import { pool } from "../db/client.js";
import { generateText } from "../ai/claude.js";
import { getTrendingClusters } from "./trending.js";

// Categories whose stories are structurally unlikely to be lighthearted.
// Crime/legal and politics can technically produce a fun story, but the
// false-positive risk (a "quirky" framing on something grim) isn't worth
// it -- the page is meant to be a genuine break from the news cycle.
const EXCLUDED_CATEGORIES = new Set(["crime_legal", "us_politics", "world_geopolitics", "international_politics"]);

const CACHE_TTL_MS = 60 * 60 * 1000;
let cache = { expiresAt: 0, ids: null };

function parseIdArray(raw) {
  const cleaned = raw.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isInteger) : null;
  } catch {
    return null;
  }
}

/**
 * Builds the Fun & Odd page from the WHOLE trending pool rather than only
 * the dedicated odd-news feeds: Claude reads the day's headlines and picks
 * the genuinely lighthearted ones (heartwarming, quirky, absurd, feel-good).
 *
 * The odd-news feeds are still included as candidates -- they're a good
 * source of this material -- they're just no longer the only source, so
 * the page can surface a charming story that happened to run in the tech
 * or entertainment sections.
 *
 * Falls back to the fun_odd category alone if the model call fails, so the
 * page is never empty.
 */
export async function getLightheartedClusters({ limit = 10 } = {}) {
  if (cache.ids && cache.expiresAt > Date.now()) {
    const { rows } = await pool.query(
      `SELECT c.id, c.representative_title, c.category, c.trending_score,
         (SELECT a2.url FROM articles a2 WHERE a2.cluster_id = c.id ORDER BY a2.published_at DESC NULLS LAST LIMIT 1) AS top_url,
         (SELECT a2.source_name FROM articles a2 WHERE a2.cluster_id = c.id ORDER BY a2.published_at DESC NULLS LAST LIMIT 1) AS top_source,
         (SELECT a2.published_at FROM articles a2 WHERE a2.cluster_id = c.id ORDER BY a2.published_at DESC NULLS LAST LIMIT 1) AS top_published_at,
         (SELECT a2.image_url FROM articles a2 WHERE a2.cluster_id = c.id AND a2.image_url IS NOT NULL ORDER BY a2.published_at DESC NULLS LAST LIMIT 1) AS top_image,
         (SELECT a2.image_is_stock FROM articles a2 WHERE a2.cluster_id = c.id AND a2.image_url IS NOT NULL ORDER BY a2.published_at DESC NULLS LAST LIMIT 1) AS top_image_is_stock,
         COUNT(DISTINCT a.source_name) AS source_count
       FROM clusters c JOIN articles a ON a.cluster_id = c.id
       WHERE c.id = ANY($1) GROUP BY c.id ORDER BY c.trending_score DESC`,
      [cache.ids]
    );
    if (rows.length > 0) return rows;
  }

  // The odd pool MUST be queried on its own rather than filtered out of a
  // general trending list. trending_score is (distinct outlets covering
  // the story) decayed over time, and odd stories are almost always
  // single-outlet -- so they score near the floor and a global top-N is
  // entirely regular news before you ever reach them. Filtering that list
  // produced a fun page with zero odd stories on it.
  const [oddPool, generalPool] = await Promise.all([
    getTrendingClusters({ category: "fun_odd", limit: 200 }),
    getTrendingClusters({ limit: 200 }),
  ]);

  const regularPool = generalPool.filter(
    (c) => c.category !== "fun_odd" && !EXCLUDED_CATEGORIES.has(c.category)
  );
  const fallback = () => oddPool.slice(0, limit);

  if (oddPool.length === 0 && regularPool.length === 0) return [];

  // Odd-news outlets are the intended backbone of this page, so they take
  // the majority of slots. Regular-news stories keep a reserved share so a
  // genuinely charming tech or culture piece can still surface alongside.
  // Per-outlet variety is enforced by MAX_PER_OUTLET below.

  const REGULAR_SLOTS = Math.min(Math.round(limit * 0.25), regularPool.length);
  const ODD_SLOTS = limit - REGULAR_SLOTS;

  // Claude is asked in batches rather than one huge prompt: a single call
  // listing hundreds of headlines both truncates and degrades.
  const BATCH = 60;
  async function pickFrom(candidatePool, want, label) {
    if (candidatePool.length === 0 || want <= 0) return [];
    const batches = [];
    for (let i = 0; i < candidatePool.length; i += BATCH) batches.push(candidatePool.slice(i, i + BATCH));
    const perBatch = Math.max(4, Math.ceil(want / batches.length) + 3);

    const results = await Promise.all(
      batches.map(async (batch) => {
        try {
          const lines = batch.map((c) => `${c.id}: ${c.representative_title}`).join("\n");
          const raw = await generateText({
            system:
              "You select lighthearted news for a newspaper's fun page. Pick stories that are genuinely fun, quirky, heartwarming, absurd, or feel-good. NEVER pick anything involving death, injury, crime, disaster, war, illness, layoffs, or human suffering -- even if the headline has a jokey tone. If fewer than the requested number qualify, return fewer. Respond with ONLY a JSON array of the numeric ids, no markdown.",
            prompt: `Pick up to ${perBatch} lighthearted stories from these headlines:\n${lines}`,
            maxTokens: 400,
          });
          const ids = parseIdArray(raw);
          if (!ids) return [];
          const byId = new Map(batch.map((c) => [c.id, c]));
          return ids.map((id) => byId.get(id)).filter(Boolean);
        } catch (err) {
          console.error(`[lighthearted] ${label} batch failed: ${err.message}`);
          return [];
        }
      })
    );
    return results.flat();
  }

  const [regularPicks, oddPicks] = await Promise.all([
    pickFrom(regularPool, REGULAR_SLOTS + 4, "regular"),
    pickFrom(oddPool, ODD_SLOTS + 8, "odd"),
  ]);

  // The real constraint: no single outlet may dominate. With ten odd
  // outlets feeding this page, a generous per-outlet cap still leaves
  // plenty of variety.
  const MAX_PER_OUTLET = 6;
  const perOutlet = new Map();
  const chosen = [];

  function take(list, slots) {
    let taken = 0;
    for (const c of list) {
      if (taken >= slots || chosen.length >= limit) break;
      const outlet = c.top_source || "Unknown";
      const used = perOutlet.get(outlet) || 0;
      if (used >= MAX_PER_OUTLET) continue;
      if (chosen.some((x) => x.id === c.id)) continue;
      perOutlet.set(outlet, used + 1);
      chosen.push(c);
      taken++;
    }
  }

  take(regularPicks, REGULAR_SLOTS);
  take(oddPicks, ODD_SLOTS);
  // Whichever side came up short, let the other fill the gap rather than
  // rendering a half-empty page.
  if (chosen.length < limit) take(regularPicks.concat(oddPicks), limit - chosen.length);

  if (chosen.length === 0) return fallback();

  cache = { expiresAt: Date.now() + CACHE_TTL_MS, ids: chosen.map((c) => c.id) };
  return chosen;
}
