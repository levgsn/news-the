// "Trending on X" page data.
//
// HEADS UP: X removed free API access in 2023. Trends, tweet search, and
// replies all require a paid tier (Basic, ~$200/mo at time of writing).
// Everything here is therefore gated behind X_BEARER_TOKEN: without it
// the module returns null and the page renders an honest placeholder
// rather than fabricated tweets. Set the token and the page lights up
// with no other code changes.
//
// Also note: the ORIGINAL blue-check verification (the legacy "notable
// account" badge) was retired platform-wide in 2023 -- it no longer
// exists to filter on. What the API still exposes is `verified_type`,
// where "blue" is the paid subscription and "business"/"government" are
// the gold/grey badges that are still granted rather than bought. The
// verified-comments filter below keeps business/government and excludes
// plain "blue", which is the closest available stand-in for "actually
// verified, not the one you pay for".
const API_BASE = "https://api.x.com/2";
const CACHE_TTL_MS = 15 * 60 * 1000;
const WOEID_US = 23424977; // Yahoo Where-On-Earth ID for the United States

let cache = { expiresAt: 0, data: null };

export function isXConfigured() {
  return Boolean(process.env.X_BEARER_TOKEN);
}

async function xGet(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` },
  });
  if (!res.ok) throw new Error(`X API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function fetchTrends() {
  const data = await xGet(`/trends/by/woeid/${WOEID_US}`);
  return (data.data ?? [])
    .slice(0, 12)
    .map((t) => ({ name: t.trend_name || t.name, volume: t.tweet_count ?? null }));
}

async function fetchTopTweets(query, max = 5) {
  const params = new URLSearchParams({
    query: `${query} -is:retweet lang:en`,
    max_results: String(Math.max(10, max)),
    "tweet.fields": "public_metrics,created_at,conversation_id",
    expansions: "author_id",
    "user.fields": "username,name,verified,verified_type",
  });
  const data = await xGet(`/tweets/search/recent?${params}`);
  const users = new Map((data.includes?.users ?? []).map((u) => [u.id, u]));
  return (data.data ?? [])
    .map((t) => {
      const author = users.get(t.author_id);
      return {
        id: t.id,
        conversationId: t.conversation_id,
        text: t.text,
        createdAt: t.created_at,
        likes: t.public_metrics?.like_count ?? 0,
        author: author ? { name: author.name, username: author.username, verifiedType: author.verified_type || null } : null,
      };
    })
    .sort((a, b) => b.likes - a.likes)
    .slice(0, max);
}

// Gold (business) / grey (government) badges only -- see module header.
function isGenuinelyVerified(user) {
  return user?.verifiedType === "business" || user?.verifiedType === "government";
}

async function fetchVerifiedReplies(conversationId, max = 3) {
  const params = new URLSearchParams({
    query: `conversation_id:${conversationId} is:reply -is:retweet`,
    max_results: "25",
    "tweet.fields": "public_metrics,created_at",
    expansions: "author_id",
    "user.fields": "username,name,verified_type",
  });
  const data = await xGet(`/tweets/search/recent?${params}`);
  const users = new Map((data.includes?.users ?? []).map((u) => [u.id, u]));
  return (data.data ?? [])
    .map((t) => ({ text: t.text, likes: t.public_metrics?.like_count ?? 0, author: users.get(t.author_id) }))
    .filter((r) => isGenuinelyVerified(r.author))
    .sort((a, b) => b.likes - a.likes)
    .slice(0, max)
    .map((r) => ({
      text: r.text,
      likes: r.likes,
      author: { name: r.author.name, username: r.author.username, verifiedType: r.author.verified_type },
    }));
}

/**
 * { trends: [...], tweets: [{...tweet, replies: [...]}] } or null when
 * X_BEARER_TOKEN isn't set. Cached 15 minutes -- the paid tiers meter
 * requests, so page views must not map 1:1 to API calls.
 */
export async function getXBundle() {
  if (!isXConfigured()) return null;
  if (cache.data && cache.expiresAt > Date.now()) return cache.data;

  try {
    const trends = await fetchTrends();
    const topTrend = trends[0]?.name;
    let tweets = [];
    if (topTrend) {
      tweets = await fetchTopTweets(topTrend, 5);
      for (const tweet of tweets) {
        try {
          tweet.replies = await fetchVerifiedReplies(tweet.conversationId, 3);
        } catch {
          tweet.replies = [];
        }
      }
    }
    const data = { trends, tweets };
    cache = { expiresAt: Date.now() + CACHE_TTL_MS, data };
    return data;
  } catch (err) {
    console.error(`[xTrends] failed: ${err.message}`);
    return { trends: [], tweets: [], error: err.message };
  }
}
