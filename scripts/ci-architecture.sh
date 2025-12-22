#!/usr/bin/env bash
set -euo pipefail

echo "==> Architecture gate: handler purity & boundaries"
# Only fail on errors, not warnings (warnings are code quality, errors are architectural violations)
pnpm eslint "packages/**/src/**/*.ts" --quiet

