#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> plugin: configure"
cmake --preset mac-debug -S "$REPO_ROOT" -B "$REPO_ROOT/build/mac-debug"

echo "==> plugin: build"
cmake --build --preset mac-debug

echo "==> webui: install"
npm ci --prefix "$REPO_ROOT/webui"

echo "==> webui: typecheck"
npm run typecheck --prefix "$REPO_ROOT/webui"

echo "==> webui: build"
npm run build --prefix "$REPO_ROOT/webui"

echo "==> mcp-server: install"
npm ci --prefix "$REPO_ROOT/mcp-server"

echo "==> mcp-server: typecheck"
npm run typecheck --prefix "$REPO_ROOT/mcp-server"

echo "==> mcp-server: build"
npm run build --prefix "$REPO_ROOT/mcp-server"

echo "==> mcp-server: test"
npm test --prefix "$REPO_ROOT/mcp-server"

echo ""
echo "All builds succeeded."
