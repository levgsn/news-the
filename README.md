# News, The — MVP aggregator

A Drudge-style news hub: pulls headlines from RSS feeds, clusters duplicate
coverage of the same story across outlets, scores stories by how many
sources are covering them (weighted by recency), and renders a minimal
front page of what's trending right now — organized into 10 topic
sections, with an alphabetical source index and a Top 10 hero strip with
thumbnails.

## What's in here

```
news-the/
  src/
    config/sources.js        # RSS feeds, each tagged with a category slug
    config/categories.js      # the 10 section labels + display order
    db/schema.sql             # Postgres schema (clusters + articles + image_url)
    db/client.js               # pg connection pool
    ingestion/fetchFeeds.js    # pulls + dedupes RSS items, extracts thumbnails
    processing/similarity.js   # headline similarity scoring (no external API)
    processing/cluster.js      # groups similar headlines into one "story"
    ranking/trending.js        # scores clusters + builds the A-Z source index
    server/index.js            # Express server + full front-page HTML
  scripts/
    migrate.js                 # applies schema.sql (safe to re-run — uses IF NOT EXISTS)
    run-ingest.js               # one ingestion pass (fetch -> cluster -> score)
```

## Front page layout

- **Header** — "NEWS, THE" on the left; on the right, a CSS-recreated
  glitch/chromatic-aberration "NEWS COMES FIRST" logo (pixel font +
  magenta/cyan offset, matching the reference image) plus a "Today's Song"
  widget using Spotify's official embed player. It's currently pointed at
  Drake's "Dreams Money Can Buy" — change the track ID in
  `TODAYS_SONG_TRACK_ID` in `src/server/index.js` to swap it (grab the ID
  from the track's `open.spotify.com/track/<ID>` URL).
- **Top 10 Trending** — a card grid with thumbnails, pulled straight from
  each story's RSS item image (see "How thumbnails work" below).
- **Sidebar** — every source that's been ingested, alphabetically, each
  a click-to-expand `<details>` dropdown showing its 5 most recent
  articles. No JavaScript needed — this uses native HTML.
- **10 category sections** — U.S. Politics, World/Geopolitics,
  Crime/Legal, Business/Economy, Technology/AI, Entertainment/Pop
  Culture, Sports, Climate/Natural Disasters, International Politics,
  Social Media/Internet Culture. Each shows its own top 10 by trending
  score.
- **Trending Now** — a larger (40-story) combined feed at the bottom, in
  the classic plain-text Drudge link-list style.

## How thumbnails work

`fetchFeeds.js` tries, in order: a standard RSS `<enclosure>` image, a
Media RSS `<media:content>`/`<media:thumbnail>` tag (common on BBC,
Guardian, etc.), then falls back to pulling the first `<img>` src out of
the item's HTML description. If none of those exist, the front page shows
a plain colored placeholder card with the source's name instead of a
broken image — this was tested against all three extraction paths plus
the no-image fallback before shipping.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env` and set `DATABASE_URL` — **use the
   PUBLIC connection string** if you're running this from your own
   machine and the database is hosted on Railway (Postgres service ->
   Variables tab -> `DATABASE_PUBLIC_URL`). The internal `DATABASE_URL`
   Railway shows only works from inside Railway's own network.
3. `npm run migrate` — creates/updates the schema. Safe to re-run any
   time you pull a schema change (it uses `IF NOT EXISTS` everywhere).
4. `npm run ingest` — runs one fetch/cluster/score pass.
5. `npm start` — starts the web server at `http://localhost:3000`.

## Deploying on Railway

1. Push this repo to GitHub, then **New Project → Deploy from GitHub
   repo** in Railway.
2. **Add a Postgres plugin** to the project — Railway auto-injects its
   internal `DATABASE_URL` into your app service, so you don't set it
   manually in production (only locally, using the public URL instead —
   see above).
3. Service **Settings → Deploy**: start command `npm start`.
4. Run `npm run migrate` once against the database (locally, pointed at
   the public URL, is the easiest way).
5. **Ingestion as its own scheduled service**, separate from the web
   server:
   - New service in the same project, same repo.
   - Start command: `npm run ingest`.
   - **Settings → Cron Schedule**: e.g. `*/10 * * * *` for every 10
     minutes. Railway spins it up, runs it to completion, and shuts it
     down — no manual triggering needed.

## Tuning

- `CLUSTER_SIMILARITY_THRESHOLD` (.env) — raise it if unrelated stories
  are getting merged into one cluster; lower it if the same story is
  showing up as multiple separate entries.
- `DECAY_HOURS` in `src/ranking/trending.js` — controls how fast a story
  falls off the front page after coverage slows down.
- Add/remove RSS sources or move one to a different category in
  `src/config/sources.js`. A few entries use a scoped Google News RSS
  search (`googleNewsFeed()` helper) as a fallback for categories
  (crime/legal, climate, international politics, social/internet
  culture) where no single outlet has one clean dedicated feed — swap
  these out for a specific outlet's RSS any time you find a better one.
- Source `weight` in `sources.js` is defined but not yet wired into
  scoring (current MVP scores by *distinct source count*, not weighted
  authority).

## Known feed issues worth knowing about

- **AP News** occasionally returns 403 — some outlets block scraper-like
  traffic intermittently. Not a bug; ingestion just skips it and
  continues.
- **Reuters** killed its official RSS feeds entirely, so `sources.js`
  points at a scoped Google News RSS search instead (real Reuters
  article links, just discovered via Google's feed rather than Reuters'
  own, since Reuters no longer publishes one).

## Next steps (in rough priority order)

1. **Wire source weight into trending score** so AP/Reuters count more
   than a smaller outlet.
2. **Prediction markets.** Kalshi and Polymarket both expose public read
   APIs (no scraping needed) — pull top-volume/most-moved markets on the
   same cron cadence as a new ingestion module.
3. **State/college local sections.** Start as pure aggregation (local
   paper + campus paper RSS feeds tagged `local:<state>` /
   `campus:<school>`) before considering any user-submitted-post feature —
   UGC brings moderation and legal exposure worth scoping separately.
4. **PWA wrapper** for "the app" — add a manifest + service worker to the
   existing server-rendered pages rather than building native apps first.
5. **Combine the 10 per-category queries into one grouped query** if page
   load feels slow on a remote/public-proxy database connection — right
   now the homepage fires ~13 queries in parallel, which is fine on a
   fast connection but is the first thing worth optimizing if it drags.

