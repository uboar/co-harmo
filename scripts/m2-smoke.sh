#!/usr/bin/env bash
# M2 end-to-end smoke test.
# Builds all three components, launches the Standalone plugin, waits for
# bridge.json to appear, runs the probe script, then tears down.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STANDALONE_APP="$REPO/build/mac-debug/plugin/co-harmo_artefacts/Debug/Standalone/co-harmo.app"
STANDALONE="$STANDALONE_APP/Contents/MacOS/co-harmo"
BRIDGE_JSON="$HOME/Library/Application Support/co-harmo/bridge.json"
PROBE="$REPO/scripts/m2-probe.mjs"

PLUGIN_PID=""
cleanup() {
  if [[ -n "$PLUGIN_PID" ]]; then
    echo "==> Stopping plugin (pid $PLUGIN_PID)"
    kill "$PLUGIN_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ── 1. Build ──────────────────────────────────────────────────────────────────
if [[ "${M2_SKIP_BUILD:-}" != "1" ]]; then
  echo "==> Building plugin (mac-debug)"
  cmake --preset mac-debug -S "$REPO" -B "$REPO/build/mac-debug"
  cmake --build --preset mac-debug

  echo "==> Building mcp-server"
  npm ci --prefix "$REPO/mcp-server"
  npm run build --prefix "$REPO/mcp-server"

  echo "==> Building webui"
  npm ci --prefix "$REPO/webui"
  npm run build --prefix "$REPO/webui"
else
  echo "==> Skipping build (M2_SKIP_BUILD=1)"
fi

# ── 2. Launch Standalone ──────────────────────────────────────────────────────
if [[ ! -f "$STANDALONE" ]]; then
  echo "ERROR: Standalone binary not found at $STANDALONE"
  exit 1
fi

echo "==> Removing stale bridge.json (if any)"
rm -f "$BRIDGE_JSON"

echo "==> Launching $STANDALONE"
"$STANDALONE" &
PLUGIN_PID=$!

# ── 3. Wait for bridge.json ───────────────────────────────────────────────────
echo "==> Waiting for bridge.json (up to 30s)..."
WAITED=0
until [[ -f "$BRIDGE_JSON" ]]; do
  sleep 1
  WAITED=$((WAITED + 1))
  if [[ $WAITED -ge 30 ]]; then
    echo "FAIL: bridge.json did not appear within 30s"
    exit 1
  fi
done
echo "    bridge.json appeared after ${WAITED}s"

# Give the WS server a moment to start accepting connections
sleep 1

# ── 4. Probe ──────────────────────────────────────────────────────────────────
echo "==> Running probe"
node "$PROBE"
