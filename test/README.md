# Local test harness

This folder is how the pipeline was verified end-to-end before handing the
project over — it doesn't hit any real RSS feeds, so it's safe to re-run as
often as you want while developing without spamming live news sites.

## What's here

- `fixtures/feed-a.xml`, `fixtures/feed-b.xml` — two fake RSS feeds. One
  story ("Senate passes major spending bill...") is worded differently in
  each feed on purpose, to test that the clustering logic correctly merges
  the same story across two "outlets" instead of treating it as two
  separate stories. Two other unrelated stories confirm non-matches stay
  separate.
- `run_test.sh` — serves both fixture feeds locally on ports 8081/8082,
  truncates the `articles`/`clusters` tables, runs `npm run ingest`
  against them, and prints the resulting clusters + articles so you can
  eyeball whether clustering behaved correctly.
- `run_server_test.sh` — boots the Express server against whatever's
  currently in the database and curls the homepage + `/api/trending` so
  you can see the rendered HTML and JSON output.

## Running it

Requires a local Postgres reachable at the `DATABASE_URL` in your `.env`
(these scripts assume `postgres:postgres@localhost:5432/news_the_test` —
edit the `psql` lines if yours differs). Run migrations once first:

```
npm run migrate
bash test/run_test.sh
bash test/run_server_test.sh
```

Expected output from `run_test.sh`: 3 clusters (not 4) — the two
differently-worded Senate stories should merge into one cluster with
`source_count = 2` and a visibly higher `trending_score` than the
single-source clusters.

If you ever change `CLUSTER_SIMILARITY_THRESHOLD` or the similarity logic
in `src/processing/similarity.js`, re-run this to make sure you haven't
broken clustering — this is exactly how a real regression (a concurrency
race that prevented same-story headlines from merging) was caught while
building this project.
