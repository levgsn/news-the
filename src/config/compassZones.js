// Labeled regions for the political-compass widget, read off the reference
// "expanded political compass" chart the user provided. Same axis
// convention used everywhere else in this app: economic in [-1, 1]
// (-1 = far left/collectivist, +1 = far right/capitalist-nationalist),
// authoritarian in [-1, 1] (+1 = authoritarian/top, -1 = anarchist/bottom).
//
// Each zone is a rectangular region (xMin/xMax/yMin/yMax), not a single
// point -- clicking ANYWHERE inside a zone's box resolves to that zone, not
// just its exact center. `query` is what gets searched for live (defaults
// to the label itself; a few are given a slightly more search-friendly
// phrase where the bare label is too ambiguous on its own).
//
// This is a hand-drawn approximation of the source image's layout, not a
// pixel-perfect trace -- easy to adjust any box below if a click feels like
// it's landing in the wrong zone.
export const COMPASS_ZONES = [
  // --- Top row: most authoritarian ---
  { label: "National Communism", xMin: -1.0, xMax: -0.55, yMin: 0.75, yMax: 1.0 },
  { label: "Totalitarianism", xMin: -0.55, xMax: -0.1, yMin: 0.75, yMax: 1.0 },
  { label: "Nationalism", xMin: -0.1, xMax: 0.4, yMin: 0.75, yMax: 1.0 },
  { label: "Fascism", xMin: 0.4, xMax: 1.0, yMin: 0.75, yMax: 1.0 },

  // --- Upper-mid row ---
  { label: "National Socialism", xMin: -1.0, xMax: -0.5, yMin: 0.55, yMax: 0.75 },
  { label: "Traditionalism", xMin: 0.15, xMax: 0.6, yMin: 0.55, yMax: 0.75 },
  { label: "Communism", xMin: -1.0, xMax: -0.85, yMin: 0.55, yMax: 1.0, query: "communism" },
  { label: "Fundamentalism", xMin: 0.85, xMax: 1.0, yMin: 0.55, yMax: 1.0 },

  // --- Mid-upper row ---
  { label: "Statism", xMin: -0.6, xMax: -0.15, yMin: 0.32, yMax: 0.55 },
  { label: "Authoritarianism", xMin: -0.15, xMax: 0.25, yMin: 0.32, yMax: 0.55 },
  { label: "Conservatism", xMin: 0.25, xMax: 0.7, yMin: 0.32, yMax: 0.55 },

  // --- Row ---
  { label: "Socialism", xMin: -1.0, xMax: -0.6, yMin: 0.12, yMax: 0.32 },
  { label: "Ultra-Capitalism", xMin: 0.6, xMax: 1.0, yMin: 0.12, yMax: 0.32 },

  // --- Center row (near-origin) ---
  { label: "Social Democratism", xMin: -0.5, xMax: -0.15, yMin: -0.12, yMax: 0.12 },
  { label: "Liberalism", xMin: -0.15, xMax: 0.15, yMin: -0.12, yMax: 0.12 },
  { label: "Progressivism", xMin: 0.15, xMax: 0.5, yMin: -0.12, yMax: 0.12 },

  // --- Row ---
  { label: "Democratic Socialism", xMin: -1.0, xMax: -0.6, yMin: -0.32, yMax: -0.12 },
  { label: "Libertarian Capitalism", xMin: 0.6, xMax: 1.0, yMin: -0.32, yMax: -0.12 },

  // --- Row ---
  { label: "Left-Libertarian", xMin: -0.5, xMax: -0.15, yMin: -0.52, yMax: -0.32 },
  { label: "Activism", xMin: -0.15, xMax: 0.15, yMin: -0.52, yMax: -0.32 },
  { label: "Libertarianism", xMin: 0.15, xMax: 0.5, yMin: -0.52, yMax: -0.32 },

  // --- Row: anarchist-leaning ---
  { label: "Anarcho-Socialism", xMin: -0.85, xMax: -0.4, yMin: -0.72, yMax: -0.52 },
  { label: "Anarchism", xMin: 0.25, xMax: 0.7, yMin: -0.72, yMax: -0.52 },
  { label: "Anarcho-Communism", xMin: -1.0, xMax: -0.85, yMin: -0.9, yMax: -0.32, query: "anarcho-communism" },
  { label: "Anarcho-Capitalism", xMin: 0.85, xMax: 1.0, yMin: -0.9, yMax: -0.32, query: "anarcho-capitalism" },

  // --- Row ---
  { label: "Syndicalism", xMin: -0.5, xMax: -0.15, yMin: -0.88, yMax: -0.72 },
  { label: "Mutualism", xMin: -0.1, xMax: 0.3, yMin: -0.88, yMax: -0.72 },

  // --- Bottom row: most anarchist ---
  { label: "Anarcho-Collectivist", xMin: -1.0, xMax: -0.5, yMin: -1.0, yMax: -0.88 },
  { label: "Ultra-Anarchism", xMin: 0.15, xMax: 0.6, yMin: -1.0, yMax: -0.88 },
];

function center(zone) {
  return { x: (zone.xMin + zone.xMax) / 2, y: (zone.yMin + zone.yMax) / 2 };
}

/**
 * Returns every zone sorted nearest-first to a clicked (economic,
 * authoritarian) point. The compass UI no longer draws these zones as
 * visible boxes -- they're purely an internal search-query lookup now --
 * so there's no bounding-box containment check anymore, just "which
 * zones are closest to where you clicked." The caller (see
 * /api/compass in server/index.js) tries these in order and falls
 * through to the next-nearest one if a zone's live search comes back
 * empty, so a click anywhere always has a good shot at real results.
 */
export function findZonesNearPoint(economic, authoritarian) {
  return COMPASS_ZONES.map((zone) => {
    const c = center(zone);
    return { zone, distance: Math.hypot(c.x - economic, c.y - authoritarian) };
  })
    .sort((a, b) => a.distance - b.distance)
    .map((entry) => entry.zone);
}
