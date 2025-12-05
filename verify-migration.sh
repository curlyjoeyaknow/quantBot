#!/bin/bash
#
# Verify Migration Success
# ========================
# Quick script to verify the package migration is working correctly
#

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║       QuantBot Package Migration Verification               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Check for dist directories
echo "📁 Checking build outputs..."
for pkg in utils storage simulation services; do
  if [ -d "packages/$pkg/dist" ]; then
    count=$(find "packages/$pkg/dist" -name "*.d.ts" | wc -l)
    echo "  ✓ @quantbot/$pkg - $count declaration files"
  else
    echo "  ✗ @quantbot/$pkg - dist/ missing"
  fi
done
echo ""

# Check package.json dependencies
echo "📦 Checking package dependencies..."
for pkg in utils storage simulation services monitoring bot; do
  if [ -f "packages/$pkg/package.json" ]; then
    deps=$(grep -o '@quantbot/[a-z]*' "packages/$pkg/package.json" | sort -u | wc -l)
    echo "  • @quantbot/$pkg - $deps @quantbot dependencies"
  fi
done
echo ""

# Check tsconfig references
echo "🔧 Checking TypeScript references..."
for pkg in utils storage simulation services monitoring bot; do
  if [ -f "packages/$pkg/tsconfig.json" ]; then
    refs=$(grep -o '"path": "../[a-z]*"' "packages/$pkg/tsconfig.json" | wc -l)
    echo "  • @quantbot/$pkg - $refs project references"
  fi
done
echo ""

# Test imports
echo "🔍 Checking for old relative imports..."
old_imports=$(find packages/*/src -name "*.ts" -not -path "*/node_modules/*" -exec grep -l "from '\.\./\.\." {} \; 2>/dev/null | wc -l)
if [ "$old_imports" -eq 0 ]; then
  echo "  ✓ No old relative imports found!"
else
  echo "  ⚠️  Found $old_imports files with old imports"
fi
echo ""

# Build summary
echo "🏗️  Build Status:"
./build-packages.sh 2>&1 | grep -E "✓|✗" | head -10
echo ""

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  For detailed info, see:                                     ║"
echo "║  • COMPLETION_STATUS.md - Full migration summary             ║"
echo "║  • FINAL_ACHIEVEMENT.md - Detailed achievements              ║"
echo "║  • NEXT_STEPS.md        - Optional remaining work            ║"
echo "╚══════════════════════════════════════════════════════════════╝"

