#!/usr/bin/env bash
set -euo pipefail

# Clean build artifacts: dist folders and TypeScript build info cache
rm -rf dist/ packages/*/dist/
find packages -name "*.tsbuildinfo" -type f -delete

echo "✅ Cleaned dist/ directories and TypeScript build info files"

