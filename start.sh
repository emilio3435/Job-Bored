#!/usr/bin/env bash
# Dashboard (http://localhost:8080) + Cheerio scraper (http://127.0.0.1:3847)
# Same as: npm start
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ ! -d node_modules || ! -d server/node_modules ]]; then
  echo "Installing dependencies (first run)..."
  npm install
fi

exec npm start
