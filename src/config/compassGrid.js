// The political compass is a 4x4 grid: 4 economic bands (far-left to
// far-right) x 4 authoritarian bands (far-authoritarian to
// far-libertarian) = 16 cells. Each cell gets its own AI-generated search
// terms (see src/ai/compassQueries.js) -- `query` here is only the
// fallback used if that generation fails, so every cell still works
// without the AI step.
// Fallback queries are deliberately phrased as CONCRETE NEWS TOPICS, not
// ideology names -- academic labels like "agorism" or "anarcho-communism"
// are real ideologies but essentially never appear in news copy, so they
// return zero results. Same rule the AI prompt enforces
// (src/ai/compassQueries.js).
const ECON_BANDS = [
  { label: "Far-Left", query: "wealth redistribution" },
  { label: "Left", query: "workers rights" },
  { label: "Right", query: "tax cuts business" },
  { label: "Far-Right", query: "immigration crackdown" },
];

const AUTH_BANDS = [
  { label: "Far-Authoritarian", query: "government crackdown" },
  { label: "Authoritarian", query: "surveillance policy" },
  { label: "Libertarian", query: "civil liberties" },
  { label: "Far-Libertarian", query: "government overreach" },
];

export const GRID_CELLS = [];
for (let row = 0; row < 4; row++) {
  for (let col = 0; col < 4; col++) {
    const authBand = AUTH_BANDS[row];
    const econBand = ECON_BANDS[col];
    GRID_CELLS.push({
      key: `r${row}c${col}`,
      label: `${econBand.label} / ${authBand.label}`,
      xMin: -1 + col * 0.5,
      xMax: -1 + (col + 1) * 0.5,
      yMin: 1 - (row + 1) * 0.5,
      yMax: 1 - row * 0.5,
      fallbackTerms: [econBand.query, authBand.query],
    });
  }
}

export function getGridCell(economic, authoritarian) {
  const col = Math.min(3, Math.max(0, Math.floor((economic + 1) / 0.5)));
  const row = Math.min(3, Math.max(0, Math.floor((1 - authoritarian) / 0.5)));
  return GRID_CELLS[row * 4 + col];
}

function cellCenter(cell) {
  return { x: (cell.xMin + cell.xMax) / 2, y: (cell.yMin + cell.yMax) / 2 };
}

/**
 * The cell the point is in, plus every other cell ordered nearest-first.
 * `secondary` (the closest neighbor) supplies the blend mix so a point
 * near a border reads as a blend of both rather than a hard cutover;
 * `rest` is the backfill chain used to top a thin cell up to a full list
 * -- not every cell gets fresh coverage on a given day, so a sparse cell
 * borrows from its ideological neighbors instead of showing two stories.
 */
export function getNearestCells(economic, authoritarian) {
  const primary = getGridCell(economic, authoritarian);
  const others = GRID_CELLS.filter((cell) => cell.key !== primary.key)
    .map((cell) => {
      const c = cellCenter(cell);
      return { cell, dist: Math.hypot(c.x - economic, c.y - authoritarian) };
    })
    .sort((a, b) => a.dist - b.dist)
    .map((entry) => entry.cell);

  return { primary, secondary: others[0] || null, rest: others.slice(1) };
}

/**
 * The "rating" for a dropped point: bilinear weights over the four
 * quadrant identities, top two normalized to 100 -- e.g. a point high up
 * and slightly left of center reads "58% Authoritarian Left / 42%
 * Authoritarian Right". Dead-center on an axis splits evenly.
 */
export function quadrantBlend(economic, authoritarian) {
  const wRight = (economic + 1) / 2;
  const wAuth = (authoritarian + 1) / 2;
  const weights = [
    { label: "Authoritarian Left", w: (1 - wRight) * wAuth },
    { label: "Authoritarian Right", w: wRight * wAuth },
    { label: "Libertarian Left", w: (1 - wRight) * (1 - wAuth) },
    { label: "Libertarian Right", w: wRight * (1 - wAuth) },
  ].sort((a, b) => b.w - a.w);

  const [first, second] = weights;
  const total = first.w + second.w;
  if (total === 0 || second.w / total < 0.005) {
    return [{ label: first.label, pct: 100 }];
  }
  const firstPct = Math.round((first.w / total) * 100);
  return [
    { label: first.label, pct: firstPct },
    { label: second.label, pct: 100 - firstPct },
  ];
}
