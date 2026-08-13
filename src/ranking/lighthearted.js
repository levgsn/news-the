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

  const pool_ = await getTrendingClusters({ limit: 120 });
  const eligible = pool_.filter((c) => !EXCLUDED_CATEGORIES.has(c.category));
  const fallback = () => pool_.filter((c) => c.category === "fun_odd").slice(0, limit);

  if (eligible.length === 0) return fallback();

  // Ask over the two pools SEPARATELY rather than once over everything.
  // A single call reliably returns mostly odd-news picks -- those headlines
  // are the most overtly lighthearted, so they win on merit every time --
  // and the exact mix varied run to run, which made a post-hoc cap
  // unreliable. Splitting the request guarantees the page always carries
  // regular-news stories, whatever the model happens to favour.
  const oddPool = eligible.filter((c) => c.category === "fun_odd");
  const regularPool = eligible.filter((c) => c.category !== "fun_odd");

  const ODD_SLOTS = Math.min(Math.floor(limit * 0.4), oddPool.length);
  const REGULAR_SLOTS = limit - ODD_SLOTS;

  async function pickFrom(candidatePool, want, label) {
    if (candidatePool.length === 0 || want <= 0) return [];
    try {
      const lines = candidatePool.map((c) => `${c.id}: ${c.representative_title}`).join("\n");
      const raw = await generateText({
        system:
          "You select lighthearted news for a newspaper's fun page. Pick stories that are genuinely fun, quirky, heartwarming, absurd, or feel-good. NEVER pick anything involving death, injury, crime, disaster, war, illness, layoffs, or human suffering -- even if the headline has a jokey tone. If fewer than the requested number qualify, return fewer. Respond with ONLY a JSON array of the numeric ids, no markdown.",
        prompt: `Pick up to ${want} lighthearted stories from these headlines:\n${lines}`,
        maxTokens: 300,
      });
      const ids = parseIdArray(raw);
      if (!ids) return [];
      const byId = new Map(candidatePool.map((c) => [c.id, c]));
      return ids.map((id) => byId.get(id)).filter(Boolean);
    } catch (err) {
      console.error(`[lighthearted] ${label} classification failed: ${err.message}`);
      return [];
    }
  }

  const [regularPicks, oddPicks] = await Promise.all([
    pickFrom(regularPool, REGULAR_SLOTS + 4, "regular"),
    pickFrom(oddPool, ODD_SLOTS + 2, "odd"),
  ]);

  // Cap any single outlet so one prolific feed can't dominate even within
  // its own half of the page.
  const MAX_PER_OUTLET = 3;
  const perOutlet = new Map();
  const chosen = [];

  function take(list, slots) {
    let taken = 0;
    for (const c of list) {
      if (taken >= slots || chosen.length >= limit) break;
      const outlet = c.top_source || "Unknown";
      const used = perOutlet.get(outlet) || 0;
      if (used >= MAX_PER_OUTLET) continue;
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
