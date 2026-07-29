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

- **Header** — "NEWS, THE" on the left; on the right, a large CSS-recreated
  glitch/chromatic-aberration "NEWS COMES FIRST" logo (pixel font +
  magenta/cyan offset) sized to fill that side of the header, plus a
  "Today's Song" widget using Spotify's official embed player.
- **Hero strip** — a 5-across/2-down grid combining U.S. Politics,
  World/Geopolitics, and Crime/Legal (the three categories requested up
  front), with thumbnails. Change `HERO_CATEGORIES` in
  `src/server/index.js` to feature different categories instead.
- **Sidebar** — two alphabetical dropdown groups: every ingested source,
  and every U.S. state with news about it. Both use native `<details>`
  elements — no JavaScript needed.
- **10 category sections** (all of them, including the 3 also featured in
  the hero) — each a bordered card showing its own top 10 by trending
  score, laid out in a centered 2-column grid.
- **Trending Now** — a larger (40-story) combined feed at the bottom.

## How thumbnails work (and how "always" is handled)

`fetchFeeds.js` first tries an RSS `<enclosure>` image, then Media RSS
`<media:content>`/`<media:thumbnail>`, then the first `<img>` in the
item's HTML description. Plenty of real feeds (Variety, Deadline, and
many others) don't include any of these at all — for those, a second
pass (`src/ingestion/backfillImages.js`, run at the end of every
`npm run ingest`) fetches the actual article page for any prominently
ranked story that still has no image and pulls its Open Graph
(`og:image`) or Twitter Card (`twitter:image`) meta tag — nearly every
publisher sets one of these even when their RSS feed doesn't include an
image. This was tested against real `og:image` and `twitter:image` pages
before shipping. If a story genuinely has neither (rare), the front page
falls back to a plain colored placeholder card with the source's name
rather than a broken image.

## State news

`src/config/sources.js` exports `STATE_SOURCES` — one feed per state,
generated from a 50-entry list rather than hand-written, each a Google
News RSS search scoped to that state's name (since there's no single
clean "all 50 states" RSS provider). Category slug is `state:<ABBR>`
(e.g. `state:KS`). These show up as their own alphabetical dropdown group
in the sidebar, separate from the outlet-based source list.

**Cost/performance note:** this adds 50 feeds to every ingestion run on
top of the ~23 national ones. Two things were changed specifically to
absorb that:
- `fetchFeeds.js` now inserts each feed's articles in **one batched
  multi-row query** instead of one `INSERT` per article — this was the
  biggest single win, since it turns "hundreds of round trips" into
  "one per feed."
- `cluster.js` now loads all recently-active clusters **once per
  ingestion run** (grouped in memory by category) instead of querying
  candidates separately for every single pending article.

If a run still feels slow on a remote/public-proxy database connection,
the first thing to try is trimming `STATE_SOURCES` down to the states you
actually care about rather than all 50 — see the comment above that
export in `sources.js`.

## Today's song, scheduled weeks in advance

Rather than hardcoding a track ID in the code (which meant a code change
+ redeploy every time you wanted to change it), there's now a
`song_schedule` table and a small admin page at **`/admin/song`** on your
live site.

1. Set `ADMIN_KEY` in `.env` to any random string.
2. Visit `https://your-site/admin/song?key=YOUR_ADMIN_KEY`.
3. Fill in a date, a Spotify track ID (the part of the URL after
   `open.spotify.com/track/`), and an optional label — you can queue up
   as many future dates as you want in one sitting.
4. The homepage automatically shows whichever song is scheduled for
   today; if nothing's scheduled, it falls back to the default track set
   in `DEFAULT_SONG_TRACK_ID` in `src/server/index.js`.

No code edits, no redeploys, no PowerShell — just that one page, from any
device.


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
3. **Campus/college local sections.** States are covered now — campus
   papers (tagged `campus:<school>`) are the remaining piece of the
   original local-news idea. Start as pure aggregation (a school's
   student-paper RSS feed) before considering any user-submitted-post
   feature — UGC brings moderation and legal exposure worth scoping
   separately.
4. **PWA wrapper** for "the app" — add a manifest + service worker to the
   existing server-rendered pages rather than building native apps first.
5. **Batch the per-category homepage queries** into one grouped query if
   page load feels slow on a remote/public-proxy database connection —
   the homepage currently fires about a dozen queries in parallel, fine
   on a fast connection but the first thing worth optimizing if it drags.

