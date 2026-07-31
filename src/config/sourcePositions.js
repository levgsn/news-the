// Curated political-lean coordinates for SOURCES entries in
// src/config/sources.js, used by the political-compass widget
// (src/ranking/compass.js) to place stories on the chart.
//
// economic: -1 (far left) .. +1 (far right)
// authoritarian: -1 (libertarian) .. +1 (authoritarian), 0 = center
// Matches the standard politicalcompass.org quadrant layout.
//
// These are curated once from general public media-bias-chart consensus
// (AllSides/Ad Fontes-style positioning) -- necessarily a simplification.
// This is editable data, not gospel: adjust freely.
//
// The four Google News aggregator feeds below are deliberately OMITTED --
// each pools coverage from many different outlets under one source_name,
// so no single position is meaningful: "Crime News (Google)",
// "Climate/Disasters (Google)", "Intl. Politics (Google)",
// "Internet Culture (Google)". All 50 STATE_SOURCES (also Google News
// aggregators, one per state) are excluded for the same reason. A cluster
// covered only by unmapped sources is excluded from compass results
// entirely (see src/ranking/compass.js) rather than given a fake position.
export const SOURCE_POLITICAL_POSITIONS = {
  "Politico": { economic: -0.2, authoritarian: 0.1 },
  "The Hill": { economic: 0.0, authoritarian: 0.0 },
  "Axios Politics": { economic: -0.1, authoritarian: -0.1 },

  "BBC World": { economic: -0.1, authoritarian: 0.15 },
  "Reuters World": { economic: -0.05, authoritarian: 0.0 },
  "AP News": { economic: -0.05, authoritarian: 0.0 },

  "Law & Crime": { economic: 0.0, authoritarian: 0.25 },

  "MarketWatch Top": { economic: 0.35, authoritarian: 0.0 },
  "CNBC Top News": { economic: 0.3, authoritarian: 0.05 },
  "Yahoo Finance": { economic: 0.25, authoritarian: 0.0 },

  "TechCrunch": { economic: -0.05, authoritarian: -0.2 },
  "The Verge": { economic: -0.2, authoritarian: -0.3 },
  "Ars Technica": { economic: -0.1, authoritarian: -0.2 },

  "Variety": { economic: -0.3, authoritarian: -0.3 },
  "Deadline": { economic: -0.3, authoritarian: -0.3 },

  "ESPN Top": { economic: 0.0, authoritarian: 0.0 },

  "Guardian Environment": { economic: -0.5, authoritarian: 0.3 },

  "Foreign Policy": { economic: -0.2, authoritarian: 0.3 },

  "Mashable": { economic: -0.2, authoritarian: -0.2 },
};

export function getSourcePosition(sourceName) {
  return SOURCE_POLITICAL_POSITIONS[sourceName] || null;
}
