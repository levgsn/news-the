import { pool } from "../db/client.js";
import { generateText } from "./claude.js";

// Two cache layers: in-memory for this process, Postgres underneath so a
// redeploy doesn't re-pay 16 Claude calls. These are ideological search
// phrases, not time-sensitive content, so there's no expiry.
const memory = new Map(); // cell.key -> string[]

function parseJsonStringArray(raw) {
  const cleaned = raw
    .trim()
    .replace(/^```(json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((s) => typeof s === "string")) {
      return parsed;
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Asks Claude for 3 real, search-friendly phrases describing what news
 * coverage looks like for a given political-compass grid cell (e.g.
 * "Far-Left / Libertarian") -- this is the "use AI to find articles that
 * fall in those boxes" part. Falls back to the cell's generic band-based
 * terms (config/compassGrid.js) if the model call fails or doesn't return
 * valid JSON, so a cell is never left without something to search for.
 */
export async function getSearchTermsForCell(cell) {
  if (memory.has(cell.key)) return memory.get(cell.key);

  const { rows } = await pool.query(`SELECT terms FROM compass_cell_terms WHERE cell_key = $1`, [cell.key]);
  if (rows[0]?.terms) {
    memory.set(cell.key, rows[0].terms);
    return rows[0].terms;
  }

  let terms = null;
  try {
    const raw = await generateText({
      system:
        "You generate news-search phrases for a political-compass grid cell. CRITICAL: return phrases that match CONCRETE NEWS TOPICS actively covered by mainstream news outlets right now -- real policy fights, movements, court cases, protests, legislation. Do NOT return academic ideology names (e.g. 'agorism', 'voluntaryism', 'paleolibertarianism', 'anarcho-communism'): those are real ideologies but almost no news article uses those words, so they return zero results. Prefer everyday reporting language a journalist would actually write (e.g. 'labor union strike', 'minimum wage increase', 'gun rights ruling', 'immigration crackdown', 'crypto regulation', 'surveillance program'). Each phrase 2-4 words. Return exactly 3 distinct phrases as ONLY a JSON array of 3 strings -- no markdown, no other text.",
      prompt: `Grid cell: economic axis ${cell.xMin} to ${cell.xMax} (-1 = far left, 1 = far right), authoritarian axis ${cell.yMin} to ${cell.yMax} (1 = authoritarian, -1 = libertarian). Approximate label: "${cell.label}". Give 3 news-topic search phrases that would surface current articles reflecting this political position.`,
      maxTokens: 150,
    });
    terms = parseJsonStringArray(raw);
  } catch (err) {
    console.error(`[compassQueries] generation failed for ${cell.key}: ${err.message}`);
  }

  const resolved = terms || cell.fallbackTerms;
  if (terms) {
    await pool.query(
      `INSERT INTO compass_cell_terms (cell_key, terms) VALUES ($1, $2)
       ON CONFLICT (cell_key) DO UPDATE SET terms = EXCLUDED.terms, generated_at = now()`,
      [cell.key, JSON.stringify(terms)]
    );
  }
  memory.set(cell.key, resolved);
  return resolved;
}
