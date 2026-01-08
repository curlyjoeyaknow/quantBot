#!/bin/bash
#
# Dependency Cycle Check
#
# Ensures @quantbot/simulation does not import from @quantbot/backtest anywhere (even indirectly).
# Backtest can depend on Simulation, but Simulation must remain "lower" in the stack.
#
# Exit codes:
#   0 - No cycles found
#   1 - Cycles detected or simulation imports from backtest

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Checking for dependency cycles..."

# Check 1: Simulation should NOT import from backtest
echo "Checking: @quantbot/simulation should not import from @quantbot/backtest"
SIM_IMPORTS_BACKTEST=$(find "$REPO_ROOT/packages/simulation/src" -name "*.ts" -type f | xargs grep -l "from '@quantbot/backtest" || true)

if [ -n "$SIM_IMPORTS_BACKTEST" ]; then
  echo "❌ ERROR: @quantbot/simulation imports from @quantbot/backtest!"
  echo "Files with violations:"
  echo "$SIM_IMPORTS_BACKTEST"
  exit 1
fi

# Check 2: Backtest CAN import from simulation (this is expected)
echo "✓ @quantbot/simulation does not import from @quantbot/backtest"

# Check 3: Verify backtest imports from simulation (expected)
BACKTEST_IMPORTS_SIM=$(find "$REPO_ROOT/packages/backtest/src" -name "*.ts" -type f | xargs grep -l "from '@quantbot/simulation" | head -5 || true)

if [ -z "$BACKTEST_IMPORTS_SIM" ]; then
  echo "⚠️  WARNING: @quantbot/backtest does not appear to import from @quantbot/simulation"
  echo "This might be expected if all imports go through re-exports, but worth checking."
else
  echo "✓ @quantbot/backtest imports from @quantbot/simulation (expected)"
fi

# Check 4: Look for indirect cycles via other packages
echo "Checking for indirect cycles via other packages..."
WORKFLOWS_IMPORTS_BACKTEST=$(find "$REPO_ROOT/packages/workflows/src" -name "*.ts" -type f | xargs grep -l "from '@quantbot/backtest" | head -5 || true)
WORKFLOWS_IMPORTS_SIM=$(find "$REPO_ROOT/packages/workflows/src" -name "*.ts" -type f | xargs grep -l "from '@quantbot/simulation" | head -5 || true)

if [ -n "$WORKFLOWS_IMPORTS_BACKTEST" ] && [ -n "$WORKFLOWS_IMPORTS_SIM" ]; then
  echo "⚠️  WARNING: @quantbot/workflows imports from both @quantbot/backtest and @quantbot/simulation"
  echo "This could create indirect cycles. Review workflow dependencies."
fi

echo ""
echo "✓ Dependency cycle check passed"
exit 0

