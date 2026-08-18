// Hand-curated outlet lean map for the Political Slider, on the site's
// 1-5 scale: 1 far left, 2 moderate left, 3 center, 4 moderate right,
// 5 far right. Based on general public media-bias consensus (AllSides /
// Ad Fontes style placement). This is editable data, not gospel -- adjust
// freely. Outlets NOT listed here get classified once by Claude and cached
// in the outlet_lean_cache table (see src/ranking/politicalSlider.js).
export const OUTLET_LEANS = {
  // --- 1: Far left ---
  "Jacobin": 1,
  "The Intercept": 1,
  "Democracy Now!": 1,
  "Truthout": 1,
  "Common Dreams": 1,
  "The Nation": 1,
  "Mother Jones": 1,
  "Current Affairs": 1,

  // --- 2: Moderate left ---
  "CNN": 2,
  "MSNBC": 2,
  "The New York Times": 2,
  "The Washington Post": 2,
  "The Guardian": 2,
  "NPR": 2,
  "HuffPost": 2,
  "Vox": 2,
  "The Atlantic": 2,
  "NBC News": 2,
  "ABC News": 2,
  "CBS News": 2,
  "Time": 2,
  "Los Angeles Times": 2,
  "Politico": 2,
  "Slate": 2,
  "Salon": 2,
  "The Daily Beast": 2,
  "Rolling Stone": 2,

  // --- 3: Center ---
  "Reuters": 3,
  "Associated Press": 3,
  "AP News": 3,
  "BBC": 3,
  "BBC News": 3,
  "The Hill": 3,
  "Axios": 3,
  "Newsweek": 3,
  "Forbes": 3,
  "CNBC": 3,
  "MarketWatch": 3,
  "Bloomberg": 3,
  "USA Today": 3,
  "The Wall Street Journal": 3,
  "Yahoo News": 3,
  "Yahoo Finance": 3,
  "Christian Science Monitor": 3,
  "United Press International": 3,

  // --- 4: Moderate right ---
  "Fox News": 4,
  "Fox Business": 4,
  "New York Post": 4,
  "Washington Examiner": 4,
  "The Washington Times": 4,
  "National Review": 4,
  "The Daily Wire": 4,
  "Daily Caller": 4,
  "The Federalist": 4,
  "The Telegraph": 4,
  "Daily Mail": 4,
  "The Epoch Times": 4,
  "The American Conservative": 4,
  "RealClearPolitics": 4,

  // --- 5: Far right ---
  "Breitbart": 5,
  "Breitbart News": 5,
  "Breitbart News Network": 5,
  "Newsmax": 5,
  "One America News Network": 5,
  "OAN": 5,
  "The Gateway Pundit": 5,
  "American Thinker": 5,

  // --- Feed names as they actually arrive ---
  // The entries above are canonical outlet names, but our RSS feeds label
  // themselves differently ("Axios Politics", not "Axios"), so almost none
  // of them matched and nearly every story fell through to AI
  // classification -- which defaults to centre and flattened the whole
  // page to one label. These are the strings that actually appear in
  // articles.source_name; keep them in sync with config/sources.js.
  "Axios Politics": 3,
  "Guardian US": 2,
  "NPR": 2,
  "BBC World": 3,
  "Reuters World": 3,
  "MarketWatch Top": 3,
  "CNBC Top News": 3,
  "ESPN Top": 3,
  "NPR Top Stories": 2,
  "Guardian Environment": 2,
  "The Verge": 2,
  "Mashable": 2,
  "TechCrunch": 3,
  "Ars Technica": 3,
  "Variety": 3,
  "Deadline": 3,
  "Foreign Policy": 3,
  "Law & Crime": 3,
  "UPI Odd News": 3,
  // Google News aggregator feeds pool many outlets under one name, so no
  // single lean is meaningful -- centre is the honest label, not a guess.
  "Crime News (Google)": 3,
  "Climate/Disasters (Google)": 3,
  "Intl. Politics (Google)": 3,
  "Internet Culture (Google)": 3,
  "Odd News (Google)": 3,
};

export const LEAN_LABELS = {
  1: "Far Left",
  2: "Moderate Left",
  3: "Center",
  4: "Moderate Right",
  5: "Far Right",
};

// Compact labels for the per-article chips, where "Moderate Left" is too
// long to sit beside an outlet name.
export const LEAN_SHORT = {
  1: "Far Left",
  2: "Left",
  3: "Center",
  4: "Right",
  5: "Far Right",
};

// Blue-to-red is the convention US readers already read as left-to-right,
// so it needs no legend. Centre is deliberately a neutral grey rather than
// purple -- purple reads as "a mix of both", which is a different claim
// than "this outlet sits in the middle".
export const LEAN_COLORS = {
  1: { bg: "#1d4ed8", fg: "#ffffff" },
  2: { bg: "#93c5fd", fg: "#0b2e6f" },
  3: { bg: "#d4d7dc", fg: "#33363c" },
  4: { bg: "#fca5a5", fg: "#7a1113" },
  5: { bg: "#b91c1c", fg: "#ffffff" },
};
