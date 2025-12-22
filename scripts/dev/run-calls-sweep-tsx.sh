#!/usr/bin/env bash
set -euo pipefail

# Run the CLI directly from TS sources (no build), so unrelated build errors don't block research.
# Usage:
#   bash scripts/dev/run-calls-sweep-tsx.sh <args you'd pass to quantbot>
#
# Example:
#   bash scripts/dev/run-calls-sweep-tsx.sh calls sweep --calls-file calls.json --out out/sweep-001

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# Build minimal dependencies first (core, utils) - these are fast and required for module resolution
# This is still much faster than building everything
echo "Building core dependencies..."
pnpm --filter @quantbot/core build > /dev/null 2>&1 || true
pnpm --filter @quantbot/utils build > /dev/null 2>&1 || true

# If your CLI entry lives elsewhere, adjust this path.
CLI_ENTRY="packages/cli/src/bin/quantbot.ts"

# Use tsx with the root tsconfig which has path mappings to source
# Note: We still need dist for core/utils for module resolution, but that's fast
exec pnpm exec tsx --tsconfig tsconfig.json "$ROOT/$CLI_ENTRY" "$@"
