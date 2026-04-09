#!/bin/bash
# Double-click in Finder (macOS) to run dashboard + scraper. Same as ./start.sh
ROOT="$(cd "$(dirname "$0")" && pwd)"
exec bash "$ROOT/start.sh"
