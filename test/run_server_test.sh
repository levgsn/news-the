#!/bin/bash
set -e
cd /home/claude/news-the
PORT=3000 node src/server/index.js > /tmp/server.log 2>&1 &
SERVER_PID=$!
sleep 1.5

echo "-- homepage --"
curl -s http://localhost:3000/ 

echo ""
echo "-- api/trending --"
curl -s http://localhost:3000/api/trending | head -c 800

kill $SERVER_PID 2>/dev/null || true
