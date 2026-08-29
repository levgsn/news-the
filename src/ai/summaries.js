import crypto from "node:crypto";
import { pool } from "../db/client.js";
import { generateText, ANTHROPIC_MODEL } from "./claude.js";

/**
 * Summary for a single article that isn't a cluster in our database --
 * the News Sites page pulls stories straight off an outlet's feed, so
 * there's no cluster_id to key off. Same headline-only constraint as
 * cluster summaries: no article text is available, so nothing beyond the
 * headline may be asserted.
 *
 * Returns { key, summary }. The key is what the audio route uses to find
 * this text again without the client having to send the headline back.
 */
export async function getOrGenerateAdhocSummary({ title, outlet }) {
  if (!title) return null;
  const key = crypto.createHash("sha256").update(`${title}::${outlet || ""}`).digest("hex").slice(0, 32);

  const { rows: cached } = await pool.query(`SELECT summary_text FROM adhoc_summaries WHERE cache_key = $1`, [key]);
  if (cached[0]) return { key, summary: cached[0].summary_text };

  const summary = await generateText({
    system: [
      "You are a sharp news writer producing a short brief on a single story, working only from its headline and the outlet that ran it. You have no article text, so never invent details, quotes, numbers, or outcomes that aren't in the headline.",
      "",
      "Write 2-3 sentences covering what appears to be happening and why it matters. Lead with the most concrete fact in the headline.",
      "",
      "CRITICAL -- vary your openings. Never start with a stock phrase, and never with 'Outlets are reporting', 'Reports indicate', 'According to', or any close variant. Open on the subject of the story itself.",
      "",
      "Where the headline alone is genuinely thin, say what is known and note plainly that details are limited rather than padding with speculation.",
      "",
      "Plain prose only. No markdown, no bullets -- this is displayed as plain text and read aloud by a text-to-speech engine.",
    ].join("\n"),
    prompt: `Headline: "${title}"\nOutlet: ${outlet || "unknown"}\n\nWrite the brief.`,
    maxTokens: 250,
  });

  await pool.query(
    `INSERT INTO adhoc_summaries (cache_key, title, outlet, summary_text, model)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (cache_key) DO NOTHING`,
    [key, title, outlet || null, summary, ANTHROPIC_MODEL]
  );
  return { key, summary };
}

export async function getAdhocSummaryByKey(key) {
  const { rows } = await pool.query(`SELECT summary_text FROM adhoc_summaries WHERE cache_key = $1`, [key]);
  return rows[0]?.summary_text || null;
}

function hashArticleSet(articles) {
  const fingerprint = articles.map((a) => `${a.source_name}::${a.title}`).sort().join("|");
  return crypto.createHash("sha256").update(fingerprint).digest("hex");
}

/**
 * There's no article body text stored anywhere in this app -- only titles
 * and source names per cluster. This is deliberately a headline synthesis
 * ("here's what outlets are reporting"), not a full-article summary; live
 * body-text scraping across a dozen+ outlets (paywalls, boilerplate,
 * wildly different page layouts) is a much bigger and more fragile effort
 * than this pass takes on.
 */
export async function getOrGenerateClusterSummary(clusterId) {
  const { rows: articles } = await pool.query(
    `SELECT DISTINCT source_name, title FROM articles WHERE cluster_id = $1`,
    [clusterId]
  );
  if (articles.length === 0) return null;

  const hash = hashArticleSet(articles);

  const { rows: cached } = await pool.query(
    `SELECT summary_text, content_hash FROM cluster_summaries WHERE cluster_id = $1`,
    [clusterId]
  );
  if (cached[0]?.content_hash === hash) return cached[0].summary_text;

  const headlineLines = articles.map((a) => `- ${a.source_name}: "${a.title}"`).join("\n");
  const summary = await generateText({
    system: [
      "You are a sharp news writer producing a short brief on a story, working only from the headlines and outlet names given -- you have no article text, so never invent details, quotes, numbers, or outcomes that aren't in the headlines.",
      "",
      "Write 2-4 sentences that get straight to the substance: who is involved, what actually happened, and why it matters. Lead with the most concrete, specific fact available.",
      "",
      "CRITICAL -- vary your openings. Never begin with a formulaic stock phrase, and in particular NEVER start with 'Outlets are reporting', 'Multiple outlets', 'Reports indicate', 'According to reports', 'News sources say', or any close variant. Open on the subject of the story itself. Every brief should read like it was written fresh for that story by someone who found it interesting.",
      "",
      "Match your register to the material: a policy fight reads differently from a sports trade or a celebrity story. Be engaging but factual -- no hype, no editorializing, no rhetorical questions.",
      "",
      "If different outlets frame the story in noticeably different ways, work that into a clause rather than a separate disclaimer sentence.",
      "",
      "Plain prose only. No markdown, no bullets, no headers -- this is displayed as plain text and read aloud by a text-to-speech engine.",
    ].join("\n"),
    prompt: `Headlines covering this story:\n${headlineLines}\n\nWrite the brief.`,
    maxTokens: 300,
  });

  await pool.query(
    `INSERT INTO cluster_summaries (cluster_id, summary_text, content_hash, model)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (cluster_id) DO UPDATE SET
       summary_text = EXCLUDED.summary_text, content_hash = EXCLUDED.content_hash,
       model = EXCLUDED.model, generated_at = now()`,
    [clusterId, summary, hash, ANTHROPIC_MODEL]
  );

  return summary;
}
