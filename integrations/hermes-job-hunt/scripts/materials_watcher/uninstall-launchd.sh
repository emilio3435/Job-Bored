#!/usr/bin/env bash
set -euo pipefail

LABEL="com.jobbored.materials-watcher"
TARGET="${HOME}/Library/LaunchAgents/${LABEL}.plist"

launchctl unload "${TARGET}" >/dev/null 2>&1 || true
rm -f "${TARGET}"
launchctl list | grep "${LABEL}" || true
