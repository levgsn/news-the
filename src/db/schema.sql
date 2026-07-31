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
