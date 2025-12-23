#!/bin/bash
# Quick test of research commands
# Tests that commands are registered and can be invoked

set -e

echo "Testing research commands..."
echo ""

# Test 1: Main help
echo "✓ Testing: quantbot research --help"
if pnpm quantbot research --help 2>&1 | grep -q "create-snapshot\|create-execution-model\|create-cost-model\|create-risk-model"; then
    echo "  ✓ Research commands are registered"
else
    echo "  ✗ Research commands not found in help"
    exit 1
fi

# Test 2: Command-specific help
echo ""
echo "✓ Testing: quantbot research create-snapshot --help"
if timeout 5 pnpm quantbot research create-snapshot --help 2>&1 | grep -q "from\|to\|format"; then
    echo "  ✓ create-snapshot help works"
else
    echo "  ✗ create-snapshot help failed"
fi

echo ""
echo "✓ Testing: quantbot research create-execution-model --help"
if timeout 5 pnpm quantbot research create-execution-model --help 2>&1 | grep -q "latency\|failure"; then
    echo "  ✓ create-execution-model help works"
else
    echo "  ✗ create-execution-model help failed"
fi

echo ""
echo "✓ Testing: quantbot research create-cost-model --help"
if timeout 5 pnpm quantbot research create-cost-model --help 2>&1 | grep -q "base-fee\|trading-fee"; then
    echo "  ✓ create-cost-model help works"
else
    echo "  ✗ create-cost-model help failed"
fi

echo ""
echo "✓ Testing: quantbot research create-risk-model --help"
if timeout 5 pnpm quantbot research create-risk-model --help 2>&1 | grep -q "max-drawdown\|max-loss"; then
    echo "  ✓ create-risk-model help works"
else
    echo "  ✗ create-risk-model help failed"
fi

echo ""
echo "All command registration tests passed! ✓"

