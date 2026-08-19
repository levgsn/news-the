import { pool } from "../db/client.js";
import { generateText } from "../ai/claude.js";
import { OUTLET_LEANS } from "../config/outletLeans.js";

// Resolution order: the hand-curated map first, then the DB cache of past
// Claude calls, and only genuinely-unknown outlets go to the model --
// batched into one call, then cached permanently. Shared by the Political
// Slider and the per-article lean chips so both agree on any given outlet.

const memory = new Map(); // outlet -> 1..5

function parseJson(raw) {
  const cleaned = raw.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export async function resolveOutletLeans(outletNames) {
  const outlets = [...new Set(outletNames.filter(Boolean))];
  const result = new Map();
  const unknown = [];

  for (const outlet of outlets) {
    if (memory.has(outlet)) result.set(outlet, memory.get(outlet));
    else if (OUTLET_LEANS[outlet] !== undefined) {
      memory.set(outlet, OUTLET_LEANS[outlet]);
      result.set(outlet, OUTLET_LEANS[outlet]);
    } else unknown.push(outlet);
  }

  if (unknown.length > 0) {
    const { rows } = await pool.query(`SELECT outlet, lean FROM outlet_lean_cache WHERE outlet = ANY($1)`, [unknown]);
    for (const row of rows) {
      memory.set(row.outlet, row.lean);
      result.set(row.outlet, row.lean);
    }
  }

  const stillUnknown = unknown.filter((o) => !result.has(o));
  if (stillUnknown.length > 0) {
    try {
      const raw = await generateText({
        system:
          "You classify news outlets by political lean on a 1-5 scale: 1 far left, 2 moderate left, 3 center, 4 moderate right, 5 far right. Use general media-bias consensus (AllSides/Ad Fontes style). If an outlet is obscure or apolitical (local TV, sports, entertainment trade press, wire service), use 3. Respond with ONLY a JSON object mapping each outlet name to an integer 1-5, no markdown.",
        prompt: `Classify these outlets: ${JSON.stringify(stillUnknown)}`,
        maxTokens: 600,
      });
      const parsed = parseJson(raw);
      if (parsed && typeof parsed === "object") {
        for (const outlet of stillUnknown) {
          const lean = Number(parsed[outlet]);
          const valid = Number.isInteger(lean) && lean >= 1 && lean <= 5 ? lean : 3;
          memory.set(outlet, valid);
          result.set(outlet, valid);
          await pool.query(
            `INSERT INTO outlet_lean_cache (outlet, lean) VALUES ($1, $2) ON CONFLICT (outlet) DO NOTHING`,
            [outlet, valid]
          );
        }
      }
    } catch (err) {
      console.error(`[outletLean] classification failed: ${err.message}`);
    }
  }

  // Anything still unresolved falls back to centre rather than being
  // dropped -- but is deliberately NOT cached, so it retries next time.
  for (const outlet of outlets) {
    if (!result.has(outlet)) result.set(outlet, 3);
  }
  return result;
}

/**
 * Attaches `lean` (1-5) to each cluster based on its representative
 * outlet, in place. One batched lookup for the whole set.
 */
export async function attachLeans(clusters) {
  const list = clusters.filter(Boolean);
  if (list.length === 0) return;
  const leans = await resolveOutletLeans(list.map((c) => c.top_source));
  for (const c of list) {
    c.lean = leans.get(c.top_source) ?? 3;
  }
}

export const isLeft = (c) => c.lean === 1 || c.lean === 2;
export const isRight = (c) => c.lean === 4 || c.lean === 5;

/**
 * Picks `limit` stories from a ranked candidate pool while keeping the
 * number of left-leaning and right-leaning outlets EQUAL.
 *
 * Left and right are paired off one for one, highest-trending first, and
 * capped at whichever side is scarcer -- so the page can never show four
 * left-leaning takes against one from the right. Centre coverage fills the
 * rest, and only if there still aren't enough stories to fill the page
 * does it fall back to unpaired leftovers rather than render a short page.
 *
 * Input must already have `lean` attached (see attachLeans) and be sorted
 * by whatever ranking the caller wants preserved.
 */
export function balanceLeanMix(pool, limit) {
  const left = pool.filter(isLeft);
  const right = pool.filter(isRight);
  const centre = pool.filter((c) => !isLeft(c) && !isRight(c));

  // Never let one side outnumber the other, and don't let the paired
  // stories crowd centre coverage off the page entirely.
  const maxPerSide = Math.min(left.length, right.length, Math.floor(limit / 2));

  const picked = [];
  for (let i = 0; i < maxPerSide; i++) {
    picked.push(left[i], right[i]);
  }
  for (const c of centre) {
    if (picked.length >= limit) break;
    picked.push(c);
  }
  // Leftovers are only ever added in PAIRS. Topping the page up with
  // whichever side happens to have spare stories is what broke the
  // balance the pairing above just created, so a page runs short rather
  // than lopsided -- an even split is the point of this function.
  let li = maxPerSide;
  let ri = maxPerSide;
  while (picked.length + 2 <= limit && li < left.length && ri < right.length) {
    picked.push(left[li++], right[ri++]);
  }

  // Restore the pool's original ranking -- the pairing above is a
  // selection mechanism, not a running order.
  const order = new Map(pool.map((c, i) => [c.id, i]));
  return picked.sort((a, b) => order.get(a.id) - order.get(b.id)).slice(0, limit);
}
