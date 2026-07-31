// The political compass is intentionally just 4 quadrants now -- no
// per-position ideology labels. Every click/drag anywhere inside a given
// quadrant runs the SAME search and shows the SAME results; only which
// quadrant you're in matters. `query` is a single broad, high-volume term
// chosen so each quadrant reliably returns real news (see
// src/ranking/compassSearch.js for the live GNews search + one-per-outlet
// dedup, and the /api/compass route in src/server/index.js for the final
// "politics" fallback if a quadrant ever comes back empty).
export const COMPASS_QUADRANTS = {
  authoritarian_left: { label: "Authoritarian Left", query: "socialism" },
  authoritarian_right: { label: "Authoritarian Right", query: "nationalism" },
  libertarian_left: { label: "Libertarian Left", query: "progressivism" },
  libertarian_right: { label: "Libertarian Right", query: "conservatism" },
};

export function getQuadrant(economic, authoritarian) {
  if (authoritarian >= 0) {
    return economic >= 0 ? COMPASS_QUADRANTS.authoritarian_right : COMPASS_QUADRANTS.authoritarian_left;
  }
  return economic >= 0 ? COMPASS_QUADRANTS.libertarian_right : COMPASS_QUADRANTS.libertarian_left;
}
