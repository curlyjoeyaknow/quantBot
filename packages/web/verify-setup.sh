#!/bin/bash
# Quick verification script for web package setup

set -e

echo "=== QuantBot Web Package Verification ==="
echo ""

# Check current directory
CURRENT_DIR=$(pwd)
echo "Current directory: $CURRENT_DIR"
if [[ ! "$CURRENT_DIR" == *"packages/web" ]]; then
    echo "⚠ Warning: Not in packages/web directory"
    echo "  Run this script from: packages/web/"
fi
echo ""

# Check project root
PROJECT_ROOT="$(cd .. && pwd)"
echo "Project root: $PROJECT_ROOT"
echo ""

# Verify scripts exist
echo "Checking scripts..."
SCRIPTS=(
    "scripts/legacy/data-processing/extract-bot-tokens-to-clickhouse.ts"
    "scripts/legacy/reporting/generate-weekly-reports-modular.ts"
)

for script in "${SCRIPTS[@]}"; do
    if [ -f "$PROJECT_ROOT/$script" ]; then
        echo "  ✓ $script"
    else
        echo "  ✗ $script (MISSING)"
    fi
done
echo ""

# Verify database directories
echo "Checking database paths..."
DB_PATHS=(
    "data/databases"
    "data/exports"
)

for db_path in "${DB_PATHS[@]}"; do
    if [ -d "$PROJECT_ROOT/$db_path" ]; then
        echo "  ✓ $db_path"
    else
        echo "  ✗ $db_path (MISSING)"
    fi
done
echo ""

# Check workspace packages
echo "Checking workspace packages..."
PACKAGES=(
    "@quantbot/utils"
    "@quantbot/storage"
    "@quantbot/services"
    "@quantbot/simulation"
)

for pkg in "${PACKAGES[@]}"; do
    if [ -d "node_modules/$pkg" ] || [ -L "node_modules/$pkg" ]; then
        echo "  ✓ $pkg (linked)"
    else
        echo "  ⚠ $pkg (not found - run 'npm install' from project root)"
    fi
done
echo ""

# Check TypeScript compilation
echo "Checking TypeScript compilation..."
if command -v npx &> /dev/null; then
    if npx tsc --noEmit --skipLibCheck 2>&1 | grep -q "error TS"; then
        echo "  ⚠ TypeScript errors found (check output above)"
    else
        echo "  ✓ TypeScript compilation successful"
    fi
else
    echo "  ⚠ npx not found, skipping TypeScript check"
fi
echo ""

# Check if Next.js can start
echo "Checking Next.js setup..."
if [ -f "package.json" ] && grep -q "next" package.json; then
    echo "  ✓ Next.js configured"
else
    echo "  ✗ Next.js not configured"
fi
echo ""

echo "=== Verification Complete ==="
echo ""
echo "Next steps:"
echo "1. If workspace packages are missing, run: cd ../.. && npm install"
echo "2. Test development server: npm run dev"
echo "3. Test production build: npm run build"

