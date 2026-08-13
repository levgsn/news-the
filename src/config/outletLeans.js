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
  "Newsmax": 5,
  "One America News Network": 5,
  "OAN": 5,
  "The Gateway Pundit": 5,
  "American Thinker": 5,
};

export const LEAN_LABELS = {
  1: "Far Left",
  2: "Moderate Left",
  3: "Center",
  4: "Moderate Right",
  5: "Far Right",
};
