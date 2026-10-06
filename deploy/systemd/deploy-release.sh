#!/usr/bin/env bash
# Install a prepared EasyTran source archive as an atomic VPS release.
set -euo pipefail

# PowerShell refuses to deploy through an installed helper with the old gates.
if [ "${1:-}" = '--protocol-version' ]; then
  echo 'easytran-release-v2'
  exit 0
fi

ARCHIVE="${1:-/tmp/easytran-release.tar.gz}"
APP_ROOT="${APP_ROOT:-/opt/easytran}"
RELEASES_DIR="$APP_ROOT/releases"
RELEASE_ID="$(date -u +%Y%m%d%H%M%S)-$$"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_ID"
API_BASE="${API_BASE:-http://127.0.0.1:3001}"
ENV_FILE="${ENV_FILE:-/etc/easytran/easytran-api.env}"
READY_ATTEMPTS="${READY_ATTEMPTS:-60}"
READY_INTERVAL="${READY_INTERVAL:-2}"
PREVIOUS_TARGET=""
SWITCHED=false

if [[ ! "$READY_ATTEMPTS" =~ ^[1-9][0-9]*$ || ! "$READY_INTERVAL" =~ ^[0-9]+$ ]]; then
  echo "Invalid readiness retry configuration." >&2
  exit 1
fi
if [ ! -f "$ARCHIVE" ]; then
  echo "Release archive not found: $ARCHIVE" >&2
  exit 1
fi
if [ -e "$APP_ROOT/app" ] || [ -L "$APP_ROOT/app" ]; then
  if [ ! -L "$APP_ROOT/app" ]; then
    echo "Current app must be a release symlink." >&2
    exit 1
  fi
  PREVIOUS_TARGET="$(readlink -f -- "$APP_ROOT/app")"
  if [ ! -d "$PREVIOUS_TARGET" ]; then
    echo "Previous release target is unavailable; refusing to discard it." >&2
    exit 1
  fi
fi

wait_ready() {
  local attempt
  for ((attempt = 1; attempt <= READY_ATTEMPTS; attempt++)); do
    if node --input-type=module - "$API_BASE" <<'NODE'
try {
  const response = await fetch(`${process.argv[2]}/api/ready`, { redirect: 'error', signal: AbortSignal.timeout(5000) })
  if (!response.ok || (await response.json()).ok !== true) process.exit(1)
} catch { process.exit(1) }
NODE
    then return 0; fi
    if [ "$attempt" -lt "$READY_ATTEMPTS" ]; then sleep "$READY_INTERVAL"; fi
  done
  return 1
}

smoke() {
  # Readonly HTTP probes: no transcript creation, checkout or paid provider call.
  node --input-type=module - "$API_BASE" "$1" <<'NODE'
import fs from 'node:fs'
import path from 'node:path'
try {
  const base = process.argv[2]
  const request = (route) => fetch(`${base}${route}`, { redirect: 'error', signal: AbortSignal.timeout(5000) })
  const health = await request('/api/health')
  if (!health.ok || (await health.json()).ok !== true) throw new Error()
  const page = await request('/')
  if (!page.ok || !(page.headers.get('content-type') || '').includes('text/html')) throw new Error()
  const html = await page.text()
  if (!/id=["']root["']/.test(html)) throw new Error()
  const asset = html.match(/<script[^>]+src=["'](\/assets\/[^"']+\.js)["']/)?.[1]
  const built = fs.readFileSync(path.join(process.argv[3], 'dist/index.html'), 'utf8')
  if (!asset || !built.includes(asset)) throw new Error()
  const script = await request(asset)
  if (!script.ok || !(script.headers.get('content-type') || '').includes('javascript') || !(await script.text()).length) throw new Error()
  const auth = await request('/v1/transcripts')
  if (auth.status !== 401 || (await auth.json()).error !== 'missing_api_key') throw new Error()
} catch {
  console.error('Release smoke failed: frontend, entry asset, liveness or API authentication boundary.')
  process.exit(1)
}
NODE
}

on_exit() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$SWITCHED" = true ]; then
    echo "Release verification failed; restoring previous release." >&2
    if [ -n "$PREVIOUS_TARGET" ]; then
      if ln -sfn "$PREVIOUS_TARGET" "$APP_ROOT/app.next" && mv -Tf "$APP_ROOT/app.next" "$APP_ROOT/app" && systemctl restart easytran-api; then
        if wait_ready && smoke "$PREVIOUS_TARGET"; then
          echo "Previous release restored and verified." >&2
        else
          echo "Previous symlink restored, but rollback readiness/smoke failed. Manual recovery required." >&2
        fi
      else
        echo "Rollback failed. Manual recovery required; previous target: $PREVIOUS_TARGET" >&2
      fi
    else
      rm -f "$APP_ROOT/app" || true
      systemctl stop easytran-api || true
      echo "No previous release exists; failed first release stopped." >&2
    fi
  fi
  exit "$status"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

install -d -o easytran -g easytran "$RELEASES_DIR"
install -d -o easytran -g easytran "$RELEASE_DIR"
tar -xzf "$ARCHIVE" -C "$RELEASE_DIR"
chown -R easytran:easytran "$RELEASE_DIR"

sudo -u easytran npm --prefix "$RELEASE_DIR" ci --include=dev
sudo -u easytran npm --prefix "$RELEASE_DIR" run typecheck:server
sudo -u easytran npm --prefix "$RELEASE_DIR" run build
sudo -u easytran node "$RELEASE_DIR/scripts/apply-dashboard-readiness.mjs"
# Fail before replacing app if the database contract is still missing. No DDL.
# The root-owned service env can be mode 600; do not widen its permissions.
node "$RELEASE_DIR/scripts/audit-schema-rpcs.mjs" --env "$ENV_FILE" --project-dir "$RELEASE_DIR"

ln -sfn "$RELEASE_DIR" "$APP_ROOT/app.next"
mv -Tf "$APP_ROOT/app.next" "$APP_ROOT/app"
SWITCHED=true

systemctl daemon-reload
systemctl enable easytran-api
systemctl restart easytran-api

if ! wait_ready; then
  echo "EasyTran did not become ready after deployment." >&2
  exit 1
fi
smoke "$RELEASE_DIR"
systemctl --no-pager --full status easytran-api

# Keep both active and rollback targets even when the previous release is older.
retained=0
while IFS= read -r old_release; do
  if [ "$old_release" = "$RELEASE_DIR" ] || [ "$old_release" = "$PREVIOUS_TARGET" ]; then continue; fi
  retained=$((retained + 1))
  if [ "$retained" -gt 1 ]; then rm -rf -- "$old_release"; fi
done < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2-)
rm -f "$ARCHIVE"
echo "Release readiness and smoke passed."
