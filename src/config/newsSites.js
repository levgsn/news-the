// Outlets for the "News Sites" page. Each entry is a real, publicly
// documented RSS feed -- every URL here was fetched and confirmed to
// parse before being added (see scripts/check-feeds.js). `domain` is used
// only to render the favicon.
//
// `lean` reuses the sitewide 1-5 scale from config/outletLeans.js so the
// site cards can carry the same colour coding as everything else.
export const NEWS_SITES = [
  // --- Wires / broadcast ---
  { id: "bbc", name: "BBC News", domain: "bbc.co.uk", rss: "http://feeds.bbci.co.uk/news/rss.xml" },
  { id: "cnn", name: "CNN", domain: "cnn.com", rss: "http://rss.cnn.com/rss/cnn_topstories.rss" },
  { id: "foxnews", name: "Fox News", domain: "foxnews.com", rss: "https://moxie.foxnews.com/google-publisher/latest.xml" },
  { id: "npr", name: "NPR", domain: "npr.org", rss: "https://feeds.npr.org/1001/rss.xml" },
  { id: "cbsnews", name: "CBS News", domain: "cbsnews.com", rss: "https://www.cbsnews.com/latest/rss/main" },
  { id: "nbcnews", name: "NBC News", domain: "nbcnews.com", rss: "http://feeds.nbcnews.com/nbcnews/public/news" },
  { id: "abcnews", name: "ABC News", domain: "abcnews.go.com", rss: "https://abcnews.go.com/abcnews/topstories" },
  { id: "skynews", name: "Sky News", domain: "news.sky.com", rss: "https://feeds.skynews.com/feeds/rss/home.xml" },
  { id: "pbs", name: "PBS NewsHour", domain: "pbs.org", rss: "https://www.pbs.org/newshour/feeds/rss/headlines" },
  { id: "aljazeera", name: "Al Jazeera", domain: "aljazeera.com", rss: "https://www.aljazeera.com/xml/rss/all.xml" },
  { id: "dw", name: "Deutsche Welle", domain: "dw.com", rss: "https://rss.dw.com/rdf/rss-en-all" },
  { id: "france24", name: "France 24", domain: "france24.com", rss: "https://www.france24.com/en/rss" },
  { id: "abcau", name: "ABC Australia", domain: "abc.net.au", rss: "https://www.abc.net.au/news/feed/51120/rss.xml" },

  // --- National newspapers ---
  { id: "nyt", name: "New York Times", domain: "nytimes.com", rss: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml" },
  { id: "wapo", name: "Washington Post", domain: "washingtonpost.com", rss: "https://feeds.washingtonpost.com/rss/world" },
  { id: "guardian", name: "The Guardian", domain: "theguardian.com", rss: "https://www.theguardian.com/world/rss" },
  { id: "latimes", name: "Los Angeles Times", domain: "latimes.com", rss: "https://www.latimes.com/world-nation/rss2.0.xml" },
  { id: "telegraph", name: "The Telegraph", domain: "telegraph.co.uk", rss: "https://www.telegraph.co.uk/news/rss.xml" },
  { id: "independent", name: "The Independent", domain: "independent.co.uk", rss: "https://www.independent.co.uk/news/uk/rss" },
  { id: "dailymail", name: "Daily Mail", domain: "dailymail.co.uk", rss: "https://www.dailymail.co.uk/articles.rss" },
  { id: "nypost", name: "New York Post", domain: "nypost.com", rss: "https://nypost.com/feed/" },
  { id: "thetimes", name: "The Straits Times", domain: "straitstimes.com", rss: "https://www.straitstimes.com/news/world/rss.xml" },
  { id: "toi", name: "Times of India", domain: "timesofindia.indiatimes.com", rss: "https://timesofindia.indiatimes.com/rssfeedstopstories.cms" },

  // --- Politics ---
  { id: "politico", name: "Politico", domain: "politico.com", rss: "https://rss.politico.com/politics-news.xml" },
  { id: "thehill", name: "The Hill", domain: "thehill.com", rss: "https://thehill.com/feed/" },
  { id: "axios", name: "Axios", domain: "axios.com", rss: "https://api.axios.com/feed/" },
  { id: "newsweek", name: "Newsweek", domain: "newsweek.com", rss: "https://www.newsweek.com/rss" },
  { id: "time", name: "TIME", domain: "time.com", rss: "https://time.com/feed/" },
  { id: "theatlantic", name: "The Atlantic", domain: "theatlantic.com", rss: "https://www.theatlantic.com/feed/all/" },
  { id: "vox", name: "Vox", domain: "vox.com", rss: "https://www.vox.com/rss/index.xml" },
  { id: "slate", name: "Slate", domain: "slate.com", rss: "https://slate.com/feeds/all.rss" },
  { id: "salon", name: "Salon", domain: "salon.com", rss: "https://www.salon.com/feed/" },
  { id: "motherjones", name: "Mother Jones", domain: "motherjones.com", rss: "https://www.motherjones.com/feed/" },
  { id: "intercept", name: "The Intercept", domain: "theintercept.com", rss: "https://theintercept.com/feed/?rss" },
  { id: "thenation", name: "The Nation", domain: "thenation.com", rss: "https://www.thenation.com/feed/?post_type=article" },
  { id: "breitbart", name: "Breitbart", domain: "breitbart.com", rss: "https://feeds.feedburner.com/breitbart" },
  { id: "nationalreview", name: "National Review", domain: "nationalreview.com", rss: "https://www.nationalreview.com/feed/" },
  { id: "dailycaller", name: "Daily Caller", domain: "dailycaller.com", rss: "https://dailycaller.com/feed/" },
  { id: "washexaminer", name: "Washington Examiner", domain: "washingtonexaminer.com", rss: "https://www.washingtonexaminer.com/feed" },
  { id: "reason", name: "Reason", domain: "reason.com", rss: "https://reason.com/feed/" },

  // --- Business / markets ---
  { id: "cnbc", name: "CNBC", domain: "cnbc.com", rss: "https://www.cnbc.com/id/100003114/device/rss/rss.html" },
  { id: "marketwatch", name: "MarketWatch", domain: "marketwatch.com", rss: "https://www.marketwatch.com/rss/topstories" },
  { id: "businessinsider", name: "Business Insider", domain: "businessinsider.com", rss: "https://markets.businessinsider.com/rss/news" },
  { id: "forbes", name: "Forbes", domain: "forbes.com", rss: "https://www.forbes.com/business/feed/" },
  { id: "ft", name: "Financial Times", domain: "ft.com", rss: "https://www.ft.com/rss/home" },
  { id: "economist", name: "The Economist", domain: "economist.com", rss: "https://www.economist.com/latest/rss.xml" },
  { id: "yahoofinance", name: "Yahoo Finance", domain: "finance.yahoo.com", rss: "https://finance.yahoo.com/news/rssindex" },

  // --- Tech ---
  { id: "techcrunch", name: "TechCrunch", domain: "techcrunch.com", rss: "https://techcrunch.com/feed/" },
  { id: "theverge", name: "The Verge", domain: "theverge.com", rss: "https://www.theverge.com/rss/index.xml" },
  { id: "arstechnica", name: "Ars Technica", domain: "arstechnica.com", rss: "https://feeds.arstechnica.com/arstechnica/index" },
  { id: "wired", name: "WIRED", domain: "wired.com", rss: "https://www.wired.com/feed/rss" },
  { id: "engadget", name: "Engadget", domain: "engadget.com", rss: "https://www.engadget.com/rss.xml" },
  { id: "mashable", name: "Mashable", domain: "mashable.com", rss: "https://mashable.com/feeds/rss/all" },

  // --- Sport / culture ---
  { id: "espn", name: "ESPN", domain: "espn.com", rss: "https://www.espn.com/espn/rss/news" },
  { id: "variety", name: "Variety", domain: "variety.com", rss: "https://variety.com/feed/" },
  { id: "deadline", name: "Deadline", domain: "deadline.com", rss: "https://deadline.com/feed/" },
  { id: "rollingstone", name: "Rolling Stone", domain: "rollingstone.com", rss: "https://www.rollingstone.com/feed/" },
  { id: "hollywoodreporter", name: "Hollywood Reporter", domain: "hollywoodreporter.com", rss: "https://www.hollywoodreporter.com/feed/" },
  { id: "lawandcrime", name: "Law & Crime", domain: "lawandcrime.com", rss: "https://lawandcrime.com/feed/" },
];
