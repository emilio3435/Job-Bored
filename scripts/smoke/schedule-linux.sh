#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

echo "Installing JobBored schedule at 08:00..."
npm run schedule:install -- --hour 8 --minute 0 --force

echo
echo "Schedule status:"
npm run schedule:status

echo
if command -v systemctl >/dev/null 2>&1 && systemctl --user list-timers --no-pager >/dev/null 2>&1; then
  echo "systemd user timers:"
  systemctl --user list-timers --no-pager | grep jobbored || {
    echo "Expected jobbored timer not found in systemctl output" >&2
    exit 1
  }
else
  echo "crontab fallback:"
  crontab -l | grep -A2 "JobBored daily refresh START"
fi

echo
echo "Uninstalling..."
npm run schedule:uninstall
npm run schedule:status
