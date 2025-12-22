#!/usr/bin/env bash
set -euo pipefail

echo "==> Linting boundaries & handler purity..."
pnpm eslint \
  "packages/**/src/**/*.ts" \
  "packages/**/tests/**/*.ts" \
  --max-warnings=0

