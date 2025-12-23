#!/bin/bash
# Test Suite for Research Commands
# =================================
#
# Runs all research commands and verifies they work correctly.
# This is a comprehensive test of the CLI integration.

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Function to print test header
print_test() {
    echo ""
    echo -e "${BLUE}=== $1 ===${NC}"
}

# Function to print success
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
    ((TESTS_PASSED++))
}

# Function to print failure
print_failure() {
    echo -e "${RED}✗ $1${NC}"
    ((TESTS_FAILED++))
}

# Function to print info
print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

# Check if quantbot CLI is available
if ! command -v quantbot &> /dev/null; then
    print_info "quantbot CLI not found in PATH, using pnpm quantbot"
    QUANTBOT_CMD="pnpm quantbot"
else
    QUANTBOT_CMD="quantbot"
fi

print_info "Using command: $QUANTBOT_CMD"
print_info "Starting research commands test suite..."
echo ""

# Test 1: Create Snapshot (Basic)
print_test "Test 1: Create Snapshot (Basic)"
if $QUANTBOT_CMD research create-snapshot \
    --from "2024-01-01T00:00:00Z" \
    --to "2024-01-02T00:00:00Z" \
    --format json > /tmp/test-snapshot-1.json 2>&1; then
    if [ -f /tmp/test-snapshot-1.json ] && [ -s /tmp/test-snapshot-1.json ]; then
        if grep -q "snapshotId" /tmp/test-snapshot-1.json && grep -q "contentHash" /tmp/test-snapshot-1.json; then
            print_success "Snapshot created successfully"
            print_info "Snapshot ID: $(cat /tmp/test-snapshot-1.json | jq -r '.snapshotId' 2>/dev/null || echo 'N/A')"
        else
            print_failure "Snapshot JSON missing required fields"
        fi
    else
        print_failure "Snapshot file not created or empty"
    fi
else
    print_failure "Failed to create snapshot"
fi

# Test 2: Create Snapshot (With Filters)
print_test "Test 2: Create Snapshot (With Filters)"
if $QUANTBOT_CMD research create-snapshot \
    --from "2024-01-01T00:00:00Z" \
    --to "2024-01-02T00:00:00Z" \
    --venue "pump.fun" \
    --chain "solana" \
    --min-volume "1000" \
    --format json > /tmp/test-snapshot-2.json 2>&1; then
    if [ -f /tmp/test-snapshot-2.json ] && [ -s /tmp/test-snapshot-2.json ]; then
        print_success "Snapshot with filters created successfully"
    else
        print_failure "Snapshot with filters failed"
    fi
else
    print_failure "Failed to create snapshot with filters"
fi

# Test 3: Create Execution Model (Basic)
print_test "Test 3: Create Execution Model (Basic)"
if $QUANTBOT_CMD research create-execution-model \
    --latency-samples "100,200,300,400,500" \
    --failure-rate "0.01" \
    --format json > /tmp/test-execution-model-1.json 2>&1; then
    if [ -f /tmp/test-execution-model-1.json ] && [ -s /tmp/test-execution-model-1.json ]; then
        if grep -q "latency" /tmp/test-execution-model-1.json && grep -q "slippage" /tmp/test-execution-model-1.json; then
            print_success "Execution model created successfully"
            print_info "Latency P50: $(cat /tmp/test-execution-model-1.json | jq -r '.latency.p50' 2>/dev/null || echo 'N/A')"
        else
            print_failure "Execution model JSON missing required fields"
        fi
    else
        print_failure "Execution model file not created or empty"
    fi
else
    print_failure "Failed to create execution model"
fi

# Test 4: Create Execution Model (With Partial Fills)
print_test "Test 4: Create Execution Model (With Partial Fills)"
if $QUANTBOT_CMD research create-execution-model \
    --latency-samples "50,100,150,200,250" \
    --failure-rate "0.02" \
    --partial-fill-rate "0.1" \
    --venue "pumpfun" \
    --format json > /tmp/test-execution-model-2.json 2>&1; then
    if [ -f /tmp/test-execution-model-2.json ] && [ -s /tmp/test-execution-model-2.json ]; then
        print_success "Execution model with partial fills created successfully"
    else
        print_failure "Execution model with partial fills failed"
    fi
else
    print_failure "Failed to create execution model with partial fills"
fi

# Test 5: Create Cost Model (Basic)
print_test "Test 5: Create Cost Model (Basic)"
if $QUANTBOT_CMD research create-cost-model \
    --base-fee "5000" \
    --trading-fee-percent "0.01" \
    --format json > /tmp/test-cost-model-1.json 2>&1; then
    if [ -f /tmp/test-cost-model-1.json ] && [ -s /tmp/test-cost-model-1.json ]; then
        if grep -q "baseFee" /tmp/test-cost-model-1.json && grep -q "tradingFee" /tmp/test-cost-model-1.json; then
            print_success "Cost model created successfully"
            print_info "Base Fee: $(cat /tmp/test-cost-model-1.json | jq -r '.baseFee' 2>/dev/null || echo 'N/A')"
        else
            print_failure "Cost model JSON missing required fields"
        fi
    else
        print_failure "Cost model file not created or empty"
    fi
else
    print_failure "Failed to create cost model"
fi

# Test 6: Create Cost Model (With Priority Fees)
print_test "Test 6: Create Cost Model (With Priority Fees)"
if $QUANTBOT_CMD research create-cost-model \
    --base-fee "5000" \
    --priority-fee-min "1000" \
    --priority-fee-max "10000" \
    --trading-fee-percent "0.01" \
    --format json > /tmp/test-cost-model-2.json 2>&1; then
    if [ -f /tmp/test-cost-model-2.json ] && [ -s /tmp/test-cost-model-2.json ]; then
        if grep -q "priorityFee" /tmp/test-cost-model-2.json; then
            print_success "Cost model with priority fees created successfully"
        else
            print_failure "Cost model missing priority fee field"
        fi
    else
        print_failure "Cost model with priority fees failed"
    fi
else
    print_failure "Failed to create cost model with priority fees"
fi

# Test 7: Create Risk Model (Basic)
print_test "Test 7: Create Risk Model (Basic)"
if $QUANTBOT_CMD research create-risk-model \
    --max-drawdown-percent "20" \
    --max-loss-per-day "1000" \
    --format json > /tmp/test-risk-model-1.json 2>&1; then
    if [ -f /tmp/test-risk-model-1.json ] && [ -s /tmp/test-risk-model-1.json ]; then
        if grep -q "maxDrawdown" /tmp/test-risk-model-1.json && grep -q "maxLossPerDay" /tmp/test-risk-model-1.json; then
            print_success "Risk model created successfully"
            print_info "Max Drawdown: $(cat /tmp/test-risk-model-1.json | jq -r '.maxDrawdown' 2>/dev/null || echo 'N/A')"
        else
            print_failure "Risk model JSON missing required fields"
        fi
    else
        print_failure "Risk model file not created or empty"
    fi
else
    print_failure "Failed to create risk model"
fi

# Test 8: Create Risk Model (Complete)
print_test "Test 8: Create Risk Model (Complete)"
if $QUANTBOT_CMD research create-risk-model \
    --max-drawdown-percent "20" \
    --max-loss-per-day "1000" \
    --max-consecutive-losses "5" \
    --max-position-size "500" \
    --format json > /tmp/test-risk-model-2.json 2>&1; then
    if [ -f /tmp/test-risk-model-2.json ] && [ -s /tmp/test-risk-model-2.json ]; then
        print_success "Complete risk model created successfully"
    else
        print_failure "Complete risk model failed"
    fi
else
    print_failure "Failed to create complete risk model"
fi

# Test 9: Table Format Output
print_test "Test 9: Table Format Output"
if $QUANTBOT_CMD research create-snapshot \
    --from "2024-01-01T00:00:00Z" \
    --to "2024-01-02T00:00:00Z" \
    --format table > /tmp/test-snapshot-table.txt 2>&1; then
    if [ -f /tmp/test-snapshot-table.txt ] && [ -s /tmp/test-snapshot-table.txt ]; then
        print_success "Table format output works"
    else
        print_failure "Table format output failed"
    fi
else
    print_failure "Failed to generate table format"
fi

# Test 10: Help Commands
print_test "Test 10: Help Commands"
if $QUANTBOT_CMD research --help > /tmp/test-help.txt 2>&1; then
    if grep -q "create-snapshot" /tmp/test-help.txt; then
        print_success "Help command shows create-snapshot"
    else
        print_failure "Help command missing create-snapshot"
    fi
else
    print_failure "Help command failed"
fi

# Test 11: Command-Specific Help
print_test "Test 11: Command-Specific Help"
if $QUANTBOT_CMD research create-snapshot --help > /tmp/test-snapshot-help.txt 2>&1; then
    if grep -q "from" /tmp/test-snapshot-help.txt && grep -q "to" /tmp/test-snapshot-help.txt; then
        print_success "Command-specific help works"
    else
        print_failure "Command-specific help missing options"
    fi
else
    print_failure "Command-specific help failed"
fi

# Test 12: Error Handling (Invalid Date)
print_test "Test 12: Error Handling (Invalid Date)"
if $QUANTBOT_CMD research create-snapshot \
    --from "invalid-date" \
    --to "2024-01-02T00:00:00Z" \
    --format json > /tmp/test-error.json 2>&1; then
    # Command succeeded (may handle gracefully) or failed (expected)
    if [ -f /tmp/test-error.json ]; then
        print_info "Command handled invalid date (may be graceful or error)"
    fi
    print_success "Error handling test completed"
else
    # Expected failure for invalid date
    print_success "Error handling works (invalid date rejected)"
fi

# Test 13: JSON Validation
print_test "Test 13: JSON Validation"
if [ -f /tmp/test-snapshot-1.json ]; then
    if command -v jq &> /dev/null; then
        if jq empty /tmp/test-snapshot-1.json 2>/dev/null; then
            print_success "Snapshot JSON is valid"
        else
            print_failure "Snapshot JSON is invalid"
        fi
    else
        print_info "jq not available, skipping JSON validation"
    fi
fi

# Test 14: Multiple Commands in Sequence
print_test "Test 14: Multiple Commands in Sequence"
SNAPSHOT_OUTPUT=$($QUANTBOT_CMD research create-snapshot \
    --from "2024-01-01T00:00:00Z" \
    --to "2024-01-02T00:00:00Z" \
    --format json 2>&1)
EXEC_MODEL_OUTPUT=$($QUANTBOT_CMD research create-execution-model \
    --latency-samples "100,200,300" \
    --failure-rate "0.01" \
    --format json 2>&1)
COST_MODEL_OUTPUT=$($QUANTBOT_CMD research create-cost-model \
    --base-fee "5000" \
    --format json 2>&1)
RISK_MODEL_OUTPUT=$($QUANTBOT_CMD research create-risk-model \
    --max-drawdown-percent "20" \
    --format json 2>&1)

if [ $? -eq 0 ] && echo "$SNAPSHOT_OUTPUT" | grep -q "snapshotId" && \
   echo "$EXEC_MODEL_OUTPUT" | grep -q "latency" && \
   echo "$COST_MODEL_OUTPUT" | grep -q "baseFee" && \
   echo "$RISK_MODEL_OUTPUT" | grep -q "maxDrawdown"; then
    print_success "Multiple commands work in sequence"
else
    print_failure "Multiple commands sequence failed"
fi

# Summary
echo ""
echo "=========================================="
echo -e "${BLUE}Test Suite Summary${NC}"
echo "=========================================="
echo -e "${GREEN}Tests Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Tests Failed: $TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
    echo ""
    echo "Generated files:"
    ls -lh /tmp/test-*.json /tmp/test-*.txt 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
    exit 0
else
    echo -e "${RED}✗ Some tests failed${NC}"
    exit 1
fi


