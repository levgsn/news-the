import { pool } from "../db/client.js";

// Matches on either headline text or source name -- searching an outlet's
// name (e.g. "Politico") surfaces its recent trending stories, replacing
// what the removed sidebar dropdown used to show.
export async function searchClusters({ query, limit = 40 }) {
  if (!query || !query.trim()) return [];
  const like = `%${query.trim()}%`;

  const { rows } = await pool.query(
    `SELECT
       c.id, c.representative_title, c.category, c.trending_score,
       COUNT(DISTINCT a.source_name) AS source_count,
       (SELECT a2.url FROM articles a2 WHERE a2.cluster_id = c.id ORDER BY a2.published_at DESC NULLS LAST LIMIT 1) AS top_url,
       (SELECT a2.source_name FROM articles a2 WHERE a2.cluster_id = c.id ORDER BY a2.published_at DESC NULLS LAST LIMIT 1) AS top_source,
       (SELECT a2.image_url FROM articles a2 WHERE a2.cluster_id = c.id AND a2.image_url IS NOT NULL ORDER BY a2.published_at DESC NULLS LAST LIMIT 1) AS top_image
     FROM clusters c
     JOIN articles a ON a.cluster_id = c.id
     WHERE EXISTS (
       SELECT 1 FROM articles a2 WHERE a2.cluster_id = c.id
         AND (a2.title ILIKE $1 OR a2.source_name ILIKE $1)
     )
     GROUP BY c.id
     ORDER BY c.trending_score DESC
     LIMIT $2`,
    [like, limit]
  );
  return rows;
}
