import { pool } from "../db/client.js";
import { GRID_CELLS } from "../config/compassGrid.js";
import { getSearchTermsForCell } from "../ai/compassQueries.js";
import { fetchGNews } from "./compassSearch.js";

/**
 * The daily "scan the web" pass for the 4x4 compass grid, run from
 * `npm run ingest` (which the Railway cron runs once a day) -- NOT from
 * page clicks. For each of the 16 cells: get its AI-generated search
 * phrases, query GNews for each, and upsert everything found into
 * compass_cell_articles. ~16 cells x 3 terms = ~48 GNews requests per
 * day, comfortably inside the free tier's 100/day quota, instead of
 * burning quota per visitor click.
 *
 * Nothing is deleted: a cell whose topics got no fresh coverage today
 * simply keeps serving its most recent stories from previous days.
 */
// GNews' free tier rate-limits bursts (429s), so the daily refresh paces
// itself rather than firing ~48 requests back to back. This runs in a
// once-a-day background job, so the extra couple of minutes costs nothing.
const REQUEST_SPACING_MS = 2500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function refreshCompassCells() {
  let fetched = 0;
  let inserted = 0;
  let first = true;

  for (const cell of GRID_CELLS) {
    const terms = await getSearchTermsForCell(cell);
    for (const term of terms) {
      if (!first) await sleep(REQUEST_SPACING_MS);
      first = false;
      const articles = await fetchGNews(term, 10);
      fetched += articles.length;
      for (const article of articles) {
        if (!article.title || !article.url) continue;
        const { rowCount } = await pool.query(
          `INSERT INTO compass_cell_articles (cell_key, title, url, outlet, image_url, published_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (cell_key, url) DO NOTHING`,
          [cell.key, article.title, article.url, article.source?.name || "Unknown", article.image || null, article.publishedAt || null]
        );
        inserted += rowCount;
      }
    }
  }

  return { cells: GRID_CELLS.length, fetched, inserted };
}

async function getCellArticles(cellKey, limit) {
  const { rows } = await pool.query(
    `SELECT title, url, outlet, image_url AS image, published_at AS "publishedAt"
     FROM compass_cell_articles
     WHERE cell_key = $1
     ORDER BY published_at DESC NULLS LAST
     LIMIT $2`,
    [cellKey, limit]
  );
  return rows;
}

/**
 * Instant, quota-free read for a compass click: pulls stored articles for
 * the clicked cell and its nearest neighbor, proportionally to the blend
 * score (e.g. 60% of slots from the primary cell, 40% from the
 * secondary), one story per outlet across the combined list, newest
 * first within each share.
 */
export async function getArticlesForBlend({ primary, secondary, rest = [], primaryShare, limit = 12 }) {
  const primaryCount = Math.max(1, Math.round(limit * primaryShare));
  const secondaryCount = limit - primaryCount;

  // Overfetch both pools so the one-per-outlet dedup can't starve the list.
  const [primaryPool, secondaryPool] = await Promise.all([
    getCellArticles(primary.key, limit * 3),
    secondary && secondaryCount > 0 ? getCellArticles(secondary.key, limit * 3) : Promise.resolve([]),
  ]);

  const usedOutlets = new Set();
  const usedUrls = new Set();
  const picked = [];

  function take(pool_, count) {
    let taken = 0;
    for (const article of pool_) {
      if (taken >= count || picked.length >= limit) break;
      if (usedUrls.has(article.url) || usedOutlets.has(article.outlet)) continue;
      usedUrls.add(article.url);
      usedOutlets.add(article.outlet);
      picked.push(article);
      taken++;
    }
  }

  take(primaryPool, primaryCount);
  take(secondaryPool, secondaryCount);
  // Top back up from the primary pool if the secondary share fell short.
  if (picked.length < limit) take(primaryPool, limit - picked.length);

  // Still thin? Walk outward through the remaining cells (already ordered
  // nearest-first) until the list is full. Not every cell gets fresh
  // coverage every day, so a sparse cell borrows from its ideological
  // neighbors rather than rendering a two-item list.
  for (const cell of rest) {
    if (picked.length >= limit) break;
    const pool_ = await getCellArticles(cell.key, limit * 2);
    take(pool_, limit - picked.length);
  }

  return picked;
}
