// Builds the running order for The Reel.
//
// The feed is deliberately NOT sorted by relevance. Scrolling thirty
// political stories in a row before reaching a single sports headline
// reads as a ranked list, not a feed -- so the order rotates between
// sections instead: a top story, then sports, then something odd, then
// back. Every story the paper has for the day ends up in it; the mix
// only decides what order they arrive in.

// Small seeded PRNG (mulberry32). Seeded by date so the running order is
// stable for the whole day: a reader who reloads or comes back after
// lunch resumes the same feed instead of a reshuffled one where stories
// they already scrolled past reappear in new places.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function todaySeed(now = new Date()) {
  return now.getUTCFullYear() * 10000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
}

function shuffled(list, rand) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// -1 for a left-leaning outlet, +1 for a right-leaning one, 0 for centre
// and for anything unlabelled (Fun & Odd carries no lean by design).
function leanDelta(cluster) {
  const lean = Number(cluster.lean);
  if (lean === 1 || lean === 2) return -1;
  if (lean === 4 || lean === 5) return 1;
  return 0;
}

// How far down a section's queue we're willing to reach to even out the
// left/right split. Small on purpose: the point is to nudge the balance,
// not to reorder a section into whatever the running tally wants.
const LEAN_LOOKAHEAD = 4;

// Two cards from the same outlet back to back read as a duplicate even
// when they're different stories from different sections, so a different
// outlet wins over a better lean fit.
function pickIndex(items, balance, lastSource) {
  const want = balance === 0 ? 0 : balance > 0 ? -1 : 1;
  const window = Math.min(LEAN_LOOKAHEAD, items.length);
  let fallback = -1;
  for (let i = 0; i < window; i++) {
    if (lastSource && items[i].top_source === lastSource) continue;
    if (want === 0 || leanDelta(items[i]) === want) return i;
    if (fallback < 0) fallback = i;
  }
  return fallback >= 0 ? fallback : 0;
}

/**
 * Interleaves the paper's sections into one feed.
 *
 * @param {Array<{key: string, clusters: Array}>} sections - named pools,
 *   in priority order. A cluster appearing in more than one pool is kept
 *   only in the first, so nothing is printed twice.
 * @returns {Array} every unique cluster, ordered so that consecutive
 *   entries rarely come from the same section.
 */
export function buildReelFeed(sections, { seed = todaySeed() } = {}) {
  const rand = mulberry32(seed);

  const seen = new Set();
  const queues = [];
  for (const section of sections) {
    const items = [];
    for (const cluster of section.clusters || []) {
      if (!cluster || seen.has(cluster.id)) continue;
      seen.add(cluster.id);
      items.push(cluster);
    }
    if (items.length) queues.push({ key: section.key, items });
  }

  const feed = [];
  let lastKey = null;
  let lastSource = null;
  let balance = 0; // running (right - left) count

  while (queues.some((q) => q.items.length)) {
    const round = shuffled(queues.filter((q) => q.items.length), rand);

    // A fresh round can otherwise open with whatever section closed the
    // previous one, which is the one adjacency the shuffle can't see.
    if (round.length > 1 && round[0].key === lastKey) {
      [round[0], round[1]] = [round[1], round[0]];
    }

    for (const q of round) {
      const [cluster] = q.items.splice(pickIndex(q.items, balance, lastSource), 1);
      feed.push(cluster);
      lastKey = q.key;
      lastSource = cluster.top_source || null;
      balance += leanDelta(cluster);
    }
  }

  return feed;
}
