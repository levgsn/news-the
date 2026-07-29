import { fetchAllFeeds } from "../src/ingestion/fetchFeeds.js";
import { clusterPendingArticles } from "../src/processing/cluster.js";
import { recomputeTrendingScores } from "../src/ranking/trending.js";
import { backfillMissingImages } from "../src/ingestion/backfillImages.js";
import { pool } from "../src/db/client.js";

async function main() {
  const start = Date.now();
  console.log("[run-ingest] starting fetch...");

  const results = await fetchAllFeeds();
  const totalInserted = results.reduce((sum, r) => sum + r.inserted, 0);
  const failed = results.filter((r) => r.failed).map((r) => r.source);

  console.log(`[run-ingest] fetched ${results.length} sources, ${totalInserted} new articles`);
  if (failed.length > 0) {
    console.log(`[run-ingest] sources that failed: ${failed.join(", ")}`);
  }

  const clustered = await clusterPendingArticles();
  console.log(`[run-ingest] clustered ${clustered} pending articles`);

  const scored = await recomputeTrendingScores();
  console.log(`[run-ingest] recomputed trending scores for ${scored} clusters`);

  const { checked, filled } = await backfillMissingImages();
  console.log(`[run-ingest] image backfill: checked ${checked} imageless top clusters, filled ${filled}`);

  console.log(`[run-ingest] done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  await pool.end();
}

main().catch(async (err) => {
  console.error("[run-ingest] fatal error:", err);
  await pool.end();
  process.exit(1);
});
