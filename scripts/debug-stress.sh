#!/usr/bin/env bash
set -euo pipefail

echo "=== Stress suite: quick triage ==="
echo

echo "1) Show failing tests with verbose reporter"
pnpm test:stress --reporter=verbose || true
echo

echo "2) Re-run serially (removes concurrency noise)"
pnpm test:stress --runInBand --reporter=verbose || true
echo

echo "3) Print vitest config used (if available)"
node -e "try{console.log(require('./vitest.stress.config.ts'))}catch(e){console.log('Could not require vitest.stress.config.ts (TS module?) - ok')}"

echo
echo "Done. Next: pick the TOP 3 failure signatures and fix them first."

