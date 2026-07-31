import { pool } from "../db/client.js";
import { getSourcePosition } from "../config/sourcePositions.js";

const ACTIVE_WINDOW_HOURS = 72; // matches trending.js's recomputeTrendingScores window

function avg(nums) {
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

/**
 * Loads recently-active clusters along with the distinct set of outlets
 * covering each one, then places each cluster on the political compass by
 * averaging the mapped positions of its covering outlets. Clusters covered
 * only by unmapped sources (e.g. a Google News aggregator feed with no
 * single-outlet identity) are dropped -- we can't place them, so we don't
 * guess.
 */
async function fetchClustersWithSources({ limit = 500 } = {}) {
  const { rows } = await pool.query(
    `SELECT
       c.id, c.representative_title, c.category, c.trending_score,
       array_agg(DISTINCT a.source_name) AS sources,
       (SELECT a2.url FROM articles a2 WHERE a2.cluster_id = c.id ORDER BY a2.published_at DESC NULLS LAST LIMIT 1) AS top_url,
       (SELECT a2.source_name FROM articles a2 WHERE a2.cluster_id = c.id ORDER BY a2.published_at DESC NULLS LAST LIMIT 1) AS top_source,
       (SELECT a2.image_url FROM articles a2 WHERE a2.cluster_id = c.id AND a2.image_url IS NOT NULL ORDER BY a2.published_at DESC NULLS LAST LIMIT 1) AS top_image
     FROM clusters c
     JOIN articles a ON a.cluster_id = c.id
     WHERE c.last_seen_at > now() - ($1 || ' hours')::interval
     GROUP BY c.id
     ORDER BY c.trending_score DESC
     LIMIT $2`,
    [ACTIVE_WINDOW_HOURS, limit]
  );

  return rows.flatMap((row) => {
    const positions = row.sources.map(getSourcePosition).filter(Boolean);
    if (positions.length === 0) return [];
    return [
      {
        ...row,
        source_count: row.sources.length, // lets these rows feed straight into renderHeadlineList
        compass_economic: avg(positions.map((p) => p.economic)),
        compass_authoritarian: avg(positions.map((p) => p.authoritarian)),
      },
    ];
  });
}

export function quadrantOf({ economic, authoritarian }) {
  if (authoritarian >= 0) return economic >= 0 ? "authoritarian_right" : "authoritarian_left";
  return economic >= 0 ? "libertarian_right" : "libertarian_left";
}

export async function getClustersInQuadrant(scope, { limit = 25 } = {}) {
  const placed = await fetchClustersWithSources({ limit: 500 });
  return placed
    .filter((c) => quadrantOf({ economic: c.compass_economic, authoritarian: c.compass_authoritarian }) === scope)
    .sort((a, b) => b.trending_score - a.trending_score)
    .slice(0, limit);
}
