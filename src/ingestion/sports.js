// Scores + upcoming games via ESPN's public (unofficial but long-stable,
// key-free) scoreboard endpoints. Best-effort by design: any league that
// errors or is out of season just contributes nothing. Cached in memory
// for 15 minutes so page loads don't hammer ESPN.
const LEAGUES = [
  { slug: "baseball/mlb", label: "MLB" },
  { slug: "football/nfl", label: "NFL" },
  { slug: "basketball/nba", label: "NBA" },
  { slug: "basketball/wnba", label: "WNBA" },
  { slug: "hockey/nhl", label: "NHL" },
];

const CACHE_TTL_MS = 15 * 60 * 1000;
let cache = { expiresAt: 0, data: null };

// YYYYMMDD in Eastern Time, offset by `days` from today.
function etDate(daysOffset = 0) {
  const d = new Date(Date.now() + daysOffset * 24 * 3600 * 1000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}${get("month")}${get("day")}`;
}

async function fetchScoreboard(leagueSlug, dates) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${leagueSlug}/scoreboard?dates=${dates}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return [];
    const data = await res.json();
    return data.events ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function parseEvent(event, leagueLabel) {
  const comp = event.competitions?.[0];
  if (!comp) return null;
  const home = comp.competitors?.find((c) => c.homeAway === "home");
  const away = comp.competitors?.find((c) => c.homeAway === "away");
  if (!home || !away) return null;
  return {
    league: leagueLabel,
    date: event.date || null,
    completed: Boolean(comp.status?.type?.completed),
    statusText: comp.status?.type?.shortDetail || "",
    home: { team: home.team?.shortDisplayName || home.team?.displayName || "?", score: home.score ?? "" },
    away: { team: away.team?.shortDisplayName || away.team?.displayName || "?", score: away.score ?? "" },
  };
}

/**
 * { finals: [...yesterday's completed games], upcoming: [...today+tomorrow's
 * not-yet-completed games] }, each entry {league, home, away, statusText}.
 */
export async function getSportsBundle() {
  if (cache.data && cache.expiresAt > Date.now()) return cache.data;

  const yesterday = etDate(-1);
  const todayTomorrow = `${etDate(0)}-${etDate(1)}`;

  const finals = [];
  const upcoming = [];

  await Promise.all(
    LEAGUES.map(async ({ slug, label }) => {
      const [ydayEvents, upcomingEvents] = await Promise.all([
        fetchScoreboard(slug, yesterday),
        fetchScoreboard(slug, todayTomorrow),
      ]);
      for (const e of ydayEvents) {
        const parsed = parseEvent(e, label);
        if (parsed?.completed) finals.push(parsed);
      }
      for (const e of upcomingEvents) {
        const parsed = parseEvent(e, label);
        if (parsed && !parsed.completed) upcoming.push(parsed);
      }
    })
  );

  finals.sort((a, b) => a.league.localeCompare(b.league));
  upcoming.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

  const data = { finals, upcoming: upcoming.slice(0, 20) };
  cache = { expiresAt: Date.now() + CACHE_TTL_MS, data };
  return data;
}
