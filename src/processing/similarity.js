// Deliberately dependency-free: Jaccard similarity over word shingles.
// This is cheap enough to run on every headline with zero API cost, which
// matters since the whole point of this project is to stay low-cost.
// If clustering quality becomes a problem at scale, swap this module for
// embeddings (e.g. a small OpenAI/Voyage embedding call + cosine similarity)
// without touching anything else in the pipeline — cluster.js only calls
// `titleSimilarity(a, b)`.

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "in", "on", "at", "to", "for",
  "is", "are", "was", "were", "be", "been", "with", "as", "by", "it", "its",
  "that", "this", "from", "after", "over", "into", "amid", "says", "say",
  "new", "will", "has", "have", "had", "not", "no",
]);

export function normalize(text) {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((tok) => tok.length > 1 && !STOPWORDS.has(tok));
}

function shingles(tokens, n = 2) {
  if (tokens.length < n) return new Set(tokens);
  const set = new Set();
  for (let i = 0; i <= tokens.length - n; i++) {
    set.add(tokens.slice(i, i + n).join(" "));
  }
  return set;
}

function jaccard(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Returns a 0-1 similarity score between two headlines.
 * Blends bigram-shingle Jaccard (catches phrase-level overlap) with
 * raw unigram token overlap (catches short headlines where bigrams are sparse).
 */
export function titleSimilarity(titleA, titleB) {
  const tokensA = normalize(titleA);
  const tokensB = normalize(titleB);

  const bigramScore = jaccard(shingles(tokensA, 2), shingles(tokensB, 2));
  const unigramScore = jaccard(new Set(tokensA), new Set(tokensB));

  return bigramScore * 0.6 + unigramScore * 0.4;
}
