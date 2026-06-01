#!/usr/bin/env bash
set -euo pipefail

LABEL="com.jobbored.materials-watcher"
SOURCE="/Users/emiliong/.hermes/job-hunt/scripts/materials_watcher/${LABEL}.plist"
TARGET="${HOME}/Library/LaunchAgents/${LABEL}.plist"

mkdir -p "${HOME}/Library/LaunchAgents" "/Users/emiliong/.hermes/job-hunt/logs"
cp "${SOURCE}" "${TARGET}"
launchctl unload "${TARGET}" >/dev/null 2>&1 || true
launchctl load "${TARGET}"
launchctl start "${LABEL}" || true
launchctl list | grep "${LABEL}" || true
