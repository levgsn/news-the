-- Run once via `npm run migrate` (or paste into Railway's Postgres query tab).

CREATE TABLE IF NOT EXISTS clusters (
  id SERIAL PRIMARY KEY,
  representative_title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_count INT NOT NULL DEFAULT 1,
  trending_score DOUBLE PRECISION NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS articles (
  id SERIAL PRIMARY KEY,
  cluster_id INT REFERENCES clusters(id) ON DELETE SET NULL,
  source_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  published_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_articles_cluster_id ON articles(cluster_id);
CREATE INDEX IF NOT EXISTS idx_articles_fetched_at ON articles(fetched_at);
CREATE INDEX IF NOT EXISTS idx_clusters_last_seen_at ON clusters(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_clusters_trending_score ON clusters(trending_score DESC);

-- Added later: thumbnail image pulled from the RSS item (enclosure /
-- media:content / media:thumbnail / first <img> in the description).
-- IF NOT EXISTS makes this safe to re-run against a database that was
-- already migrated before this column existed.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS image_url TEXT;
CREATE INDEX IF NOT EXISTS idx_articles_source_name ON articles(source_name);

-- Lets you schedule "today's song" weeks in advance via the /admin/song
-- page instead of editing code. One row per calendar date.
CREATE TABLE IF NOT EXISTS song_schedule (
  play_date DATE PRIMARY KEY,
  track_id TEXT NOT NULL,
  label TEXT
);

-- AI headline-synthesis summary per cluster (one story, many outlets).
-- content_hash fingerprints the exact (source_name, title) pairs the
-- summary was generated from, so a cluster picking up new outlets
-- regenerates on next request, but an unchanged cluster is a pure cache
-- hit -- no repeat Claude calls.
CREATE TABLE IF NOT EXISTS cluster_summaries (
  cluster_id INT PRIMARY KEY REFERENCES clusters(id) ON DELETE CASCADE,
  summary_text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AI daily rundown text, one per (date, political-compass-quadrant scope).
-- Lazily generated on first request for that date+scope; the UNIQUE
-- constraint is the cache key, keeping Claude calls bounded to
-- (dates x 5 scopes) rather than one per page view.
CREATE TABLE IF NOT EXISTS daily_rundowns (
  id SERIAL PRIMARY KEY,
  rundown_date DATE NOT NULL,
  scope TEXT NOT NULL, -- 'all' | 'authoritarian_left' | 'authoritarian_right' | 'libertarian_left' | 'libertarian_right'
  text_content TEXT NOT NULL,
  model TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rundown_date, scope)
);

-- Generic ElevenLabs TTS audio cache, keyed by a hash of the exact text +
-- voice spoken. Shared by article-summary and daily-rundown playback, so
-- identical text is never re-synthesized. BYTEA rather than local disk
-- because Railway's filesystem is ephemeral across redeploys.
CREATE TABLE IF NOT EXISTS tts_audio_cache (
  cache_key TEXT PRIMARY KEY,
  audio_data BYTEA NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'audio/mpeg',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The Political Slider (replaced the old 4x4 compass grid): one featured
-- event per day, with coverage of that SAME event bucketed by outlet lean
-- on a 1-5 scale (1 far left, 2 moderate left, 3 center, 4 moderate
-- right, 5 far right). Populated once daily by `npm run ingest`
-- (refreshSliderEvent in src/ranking/politicalSlider.js).
CREATE TABLE IF NOT EXISTS slider_events (
  id SERIAL PRIMARY KEY,
  event_date DATE NOT NULL UNIQUE,
  headline TEXT NOT NULL,
  query TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS slider_articles (
  id SERIAL PRIMARY KEY,
  event_id INT NOT NULL REFERENCES slider_events(id) ON DELETE CASCADE,
  lean INT NOT NULL, -- 1..5
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  outlet TEXT,
  image_url TEXT,
  published_at TIMESTAMPTZ,
  UNIQUE (event_id, url)
);
CREATE INDEX IF NOT EXISTS idx_slider_articles_event ON slider_articles(event_id, lean);

-- Claude-classified outlet leans for outlets missing from the hand-curated
-- map in src/config/outletLeans.js. Cached so each unknown outlet is
-- classified at most once.
CREATE TABLE IF NOT EXISTS outlet_lean_cache (
  outlet TEXT PRIMARY KEY,
  lean INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Today's Summary" -- either AI-generated from that day's trending
-- headlines, or the site owner's own transcript + voice recording,
-- managed via /admin/summary?key=... (mirrors the /admin/song pattern)
-- and shown publicly with a Listen button. One row per calendar date.
-- BYTEA audio for the same ephemeral-filesystem reason as tts_audio_cache.
CREATE TABLE IF NOT EXISTS daily_summary (
  summary_date DATE PRIMARY KEY,
  text_content TEXT,
  text_source TEXT, -- 'ai' | 'user'
  audio_data BYTEA,
  audio_content_type TEXT,
  audio_source TEXT, -- 'ai' | 'user'
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
