#!/usr/bin/env sh
set -eu

if [ ! -d "node_modules" ]; then
  npm install
fi

if [ ! -d "server/node_modules" ]; then
  npm install --prefix ./server
fi

mkdir -p "./.factory/library"
