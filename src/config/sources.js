// Category slugs match the site's section nav — keep these exact strings in
// sync with CATEGORIES in src/config/categories.js if you add/rename one.
//
// Where no single outlet has a clean dedicated RSS feed for a category
// (crime/legal, climate/disasters, international politics, social/internet
// culture), a scoped Google News RSS search is used as a broad, reliable
// fallback — this is a standard technique (many RSS readers do the same)
// and returns real outlet links, not Google's own content.

export function googleNewsFeed(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}

export const SOURCES = [
  // --- U.S. Politics ---
  { name: "Politico", url: "https://rss.politico.com/politics-news.xml", category: "us_politics", weight: 1.0 },
  { name: "The Hill", url: "https://thehill.com/feed/", category: "us_politics", weight: 1.0 },
  { name: "Axios Politics", url: "https://api.axios.com/feed/", category: "us_politics", weight: 1.0 },

  // --- World / Geopolitics ---
  { name: "BBC World", url: "http://feeds.bbci.co.uk/news/world/rss.xml", category: "world_geopolitics", weight: 1.1 },
  {
    name: "Reuters World",
    // Reuters killed its official RSS feeds; this is a live replacement.
    url: googleNewsFeed("when:24h allinurl:reuters.com"),
    category: "world_geopolitics",
    weight: 1.2,
  },
  { name: "AP News", url: "https://rsshub.app/apnews/topics/apf-topnews", category: "world_geopolitics", weight: 1.2 },

  // --- Crime / Legal ---
  { name: "Law & Crime", url: "https://lawandcrime.com/feed/", category: "crime_legal", weight: 1.0 },
  { name: "Crime News (Google)", url: googleNewsFeed("crime OR indictment OR trial OR sentencing"), category: "crime_legal", weight: 0.8 },

  // --- Business / Economy ---
  { name: "MarketWatch Top", url: "https://www.marketwatch.com/rss/topstories", category: "business_economy", weight: 1.0 },
  { name: "CNBC Top News", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", category: "business_economy", weight: 1.0 },
  { name: "Yahoo Finance", url: "https://finance.yahoo.com/news/rssindex", category: "business_economy", weight: 0.9 },

  // --- Technology / AI ---
  { name: "TechCrunch", url: "https://techcrunch.com/feed/", category: "technology_ai", weight: 1.0 },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", category: "technology_ai", weight: 1.0 },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", category: "technology_ai", weight: 1.0 },

  // --- Entertainment / Pop Culture ---
  { name: "Variety", url: "https://variety.com/feed/", category: "entertainment_pop_culture", weight: 0.9 },
  { name: "Deadline", url: "https://deadline.com/feed/", category: "entertainment_pop_culture", weight: 0.9 },

  // --- Sports ---
  { name: "ESPN Top", url: "https://www.espn.com/espn/rss/news", category: "sports", weight: 0.9 },

  // --- Climate / Natural Disasters ---
  { name: "Guardian Environment", url: "https://www.theguardian.com/environment/rss", category: "climate_natural_disasters", weight: 1.0 },
  { name: "Climate/Disasters (Google)", url: googleNewsFeed("wildfire OR hurricane OR earthquake OR climate disaster"), category: "climate_natural_disasters", weight: 0.8 },

  // --- International Politics (foreign policy / diplomacy, distinct from
  //     the broader breaking-news World/Geopolitics section above) ---
  { name: "Foreign Policy", url: "https://foreignpolicy.com/feed/", category: "international_politics", weight: 1.0 },
  { name: "Intl. Politics (Google)", url: googleNewsFeed("foreign policy OR diplomacy OR international relations"), category: "international_politics", weight: 0.8 },

  // --- Social Media / Internet Culture ---
  { name: "Mashable", url: "https://mashable.com/feeds/rss/all", category: "social_media_internet_culture", weight: 0.9 },
  { name: "Internet Culture (Google)", url: googleNewsFeed("TikTok OR viral OR internet culture OR social media trend"), category: "social_media_internet_culture", weight: 0.8 },

  // --- Fun / Odd News (the newspaper's lighthearted page) ---
  { name: "UPI Odd News", url: "https://rss.upi.com/news/odd_news.rss", category: "fun_odd", weight: 1.0 },
  { name: "Odd News (Google)", url: googleNewsFeed("offbeat OR quirky OR bizarre OR heartwarming story"), category: "fun_odd", weight: 0.8 },
];

// NOTE: per-state Google News feeds ("Wyoming News", "Wisconsin News", etc.)
// used to live here and were removed deliberately. They were Google News
// aggregators rather than real outlets, which meant their article links were
// redirect tokens with no retrievable artwork -- every state story rendered
// with the same placeholder -- and they crowded genuine outlets out of the
// trending ranking. Trending now draws only from the named SOURCES above.
//
// Local/college sources can still be added: same shape as above, just tag
// category as "local:<state>" or "campus:<school>",
// e.g. { name: "KU The University Daily Kansan", url: "...", category: "campus:ku", weight: 0.8 }
