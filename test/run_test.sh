#!/bin/bash
set -e

python3 -m http.server 8081 --directory /home/claude/news-the/test/fixtures > /tmp/http8081.log 2>&1 &
python3 -m http.server 8082 --directory /home/claude/news-the/test/fixtures > /tmp/http8082.log 2>&1 &
sleep 1

echo "-- feed checks --"
curl -s -o /dev/null -w "8081: %{http_code}\n" http://localhost:8081/feed-a.xml
curl -s -o /dev/null -w "8082: %{http_code}\n" http://localhost:8082/feed-b.xml

PGPASSWORD=postgres psql -h localhost -U postgres -d news_the_test -c "TRUNCATE articles, clusters RESTART IDENTITY CASCADE;"

cd /home/claude/news-the
npm run ingest

echo "-- clusters --"
PGPASSWORD=postgres psql -h localhost -U postgres -d news_the_test -c "SELECT id, category, source_count, round(trending_score::numeric,3) AS score, representative_title FROM clusters ORDER BY id;"
echo "-- articles --"
PGPASSWORD=postgres psql -h localhost -U postgres -d news_the_test -c "SELECT id, cluster_id, source_name, title FROM articles ORDER BY id;"
