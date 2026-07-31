import crypto from "node:crypto";
import { pool } from "../db/client.js";
import { generateText, ANTHROPIC_MODEL } from "./claude.js";

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
    system:
      "You synthesize how multiple news outlets are covering the same developing story, using ONLY their headlines and outlet names -- you do not have article text. Make clear this is a synthesis of headlines, not a full-article summary. 2-4 sentences, neutral tone.",
    prompt: `Headlines currently covering this story:\n${headlineLines}\n\nIn 2-4 sentences, synthesize what appears to be happening. If outlets frame it differently, note that briefly. Start with something like "Outlets are reporting..."`,
    maxTokens: 250,
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
