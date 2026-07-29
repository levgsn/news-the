#!/bin/bash
set -e

python3 -m http.server 8081 --directory /home/claude/news-the/test/fixtures > /tmp/http8081.log 2>&1 &
python3 -m http.server 8082 --directory /home/claude/news-the/test/fixtures > /tmp/http8082.log 2>&1 &
python3 -m http.server 8083 --directory /home/claude/news-the/test/fixtures > /tmp/http8083.log 2>&1 &
sleep 1

echo "-- feed checks --"
curl -s -o /dev/null -w "8081: %{http_code}\n" http://localhost:8081/feed-a.xml
curl -s -o /dev/null -w "8082: %{http_code}\n" http://localhost:8082/feed-b.xml
curl -s -o /dev/null -w "8083: %{http_code}\n" http://localhost:8083/feed-c.xml

PGPASSWORD=postgres psql -h localhost -U postgres -d news_the_test -c "TRUNCATE articles, clusters RESTART IDENTITY CASCADE;"

cd /home/claude/news-the
npm run ingest

echo "-- articles with images --"
PGPASSWORD=postgres psql -h localhost -U postgres -d news_the_test -c "SELECT id, category, source_name, image_url, title FROM articles ORDER BY id;"

echo "-- homepage render (first 200 lines) --"
PORT=3000 node src/server/index.js > /tmp/server2.log 2>&1 &
SERVER_PID=$!
sleep 1.5
curl -s http://localhost:3000/ > /tmp/homepage.html
echo "homepage bytes: $(wc -c < /tmp/homepage.html)"
grep -o 'thumb[0-9]*\.jpg' /tmp/homepage.html | sort -u
echo "-- categories present --"
grep -o '<h2>[^<]*</h2>' /tmp/homepage.html
echo "-- sidebar sources --"
grep -o '<summary>[^<]*</summary>' /tmp/homepage.html
kill $SERVER_PID 2>/dev/null || true
