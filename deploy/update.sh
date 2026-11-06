#!/usr/bin/env bash
# Moves FinTrack to a release (or the latest code) and restarts it, if its
# tests pass.  sudo deploy/update.sh v1.1.0     (or with no version: latest)
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run it with sudo: sudo deploy/update.sh [version]"; exit 1; }
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
git fetch --tags --quiet origin
if [ -n "${1:-}" ]; then git -c advice.detachedHead=false checkout --quiet "$1"; else git checkout --quiet main && git pull --quiet --ff-only; fi
echo "Now at $(git describe --tags --always)."
if ! node --test tests/*.test.js >/tmp/fintrack-tests.log 2>&1; then
  echo "The tests failed, so FinTrack wasn't restarted (it keeps running the old version). Details: /tmp/fintrack-tests.log"
  exit 1
fi
"$APP_DIR/deploy/install.sh" >/dev/null
systemctl restart fintrack
sleep 2
systemctl --no-pager --lines=5 status fintrack | sed -n '1,8p'
