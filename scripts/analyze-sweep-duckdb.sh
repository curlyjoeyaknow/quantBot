#!/usr/bin/env bash
set -euo pipefail

# Wrapper script to run analyze-sweep-duckdb.ts with proper module resolution
# Usage: bash scripts/analyze-sweep-duckdb.sh <sweep-output-dir>

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Build minimal dependencies
echo "Building core dependencies..."
pnpm --filter @quantbot/core build > /dev/null 2>&1 || true
pnpm --filter @quantbot/utils build > /dev/null 2>&1 || true

# Run with pnpm exec tsx (same as dev runner)
exec pnpm exec tsx --tsconfig tsconfig.json "$ROOT/scripts/analyze-sweep-duckdb.ts" "$@"

