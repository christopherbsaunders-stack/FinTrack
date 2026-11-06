#!/usr/bin/env bash
# Sets FinTrack up as a service that starts with the server.
# From the FinTrack folder (a clone in /opt/fintrack):  sudo deploy/install.sh
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run it with sudo: sudo deploy/install.sh"; exit 1; }
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "Node.js isn't installed. Install Node.js 22 first (see the README)."; exit 1; }
MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
[ "$MAJOR" -ge 20 ] || { echo "FinTrack needs Node.js 20 or newer; this server has $("$NODE" -v). See the README."; exit 1; }

# Its own user, with no login, and a data folder only it can open.
id fintrack >/dev/null 2>&1 || useradd --system --home-dir /var/lib/fintrack --shell /usr/sbin/nologin fintrack
install -d -o fintrack -g fintrack -m 700 /var/lib/fintrack
if ! runuser -u fintrack -- test -r "$APP_DIR/src/server.js"; then
  echo "The fintrack user can't read $APP_DIR. Clone FinTrack into /opt/fintrack instead of a home folder."
  exit 1
fi

if [ ! -f /etc/fintrack.env ]; then
  install -m 600 -o root -g root "$APP_DIR/deploy/fintrack.env.example" /etc/fintrack.env
  NEW_ENV=1
fi
sed "s#@APP_DIR@#$APP_DIR#g; s#@NODE@#$NODE#g" "$APP_DIR/deploy/fintrack.service" > /etc/systemd/system/fintrack.service
systemctl daemon-reload
systemctl enable fintrack >/dev/null

echo "FinTrack is set up as a service (Node.js $("$NODE" -v), code in $APP_DIR, data in /var/lib/fintrack)."
if [ "${NEW_ENV:-}" = 1 ]; then
  echo "Next: set the password, the names it answers to and your time zone:"
  echo "  sudo nano /etc/fintrack.env"
  echo "Then start it:"
  echo "  sudo systemctl start fintrack"
else
  echo "Restart it to use this version:  sudo systemctl restart fintrack"
fi
