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
