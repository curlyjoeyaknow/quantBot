#!/bin/bash
# Extensive 6-hour loop for random search optimization

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../.."

# Configuration (30 minutes test run)
DURATION_MINUTES=30
START_TIME=$(date +%s)
END_TIME=$((START_TIME + DURATION_MINUTES * 60))

# Date range - use actual data range (2025-05-01 to 2026-01-04)
# Leave 21 days for test window, so use 2025-12-14 as end date
FROM_DATE="2025-05-01"
TO_DATE="2025-12-14"

# Output directory
OUTPUT_DIR="results/extensive_loop_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$OUTPUT_DIR"

LOG_FILE="$OUTPUT_DIR/loop.log"

echo "==========================================" | tee -a "$LOG_FILE"
echo "Test Loop (30 min - verify fixes)" | tee -a "$LOG_FILE"
echo "Duration: $DURATION_MINUTES minutes" | tee -a "$LOG_FILE"
echo "Started: $(date)" | tee -a "$LOG_FILE"
echo "From: $FROM_DATE To: $TO_DATE" | tee -a "$LOG_FILE"
echo "Output: $OUTPUT_DIR" | tee -a "$LOG_FILE"
echo "==========================================" | tee -a "$LOG_FILE"

ITERATION=0
SEED=1000

while [ $(date +%s) -lt $END_TIME ]; do
    ITERATION=$((ITERATION + 1))
    RUN_SEED=$((SEED + ITERATION))
    ITERATION_START=$(date +%s)
    
    echo "" | tee -a "$LOG_FILE"
    echo "[$(date +%H:%M:%S)] Iteration $ITERATION (Seed: $RUN_SEED)" | tee -a "$LOG_FILE"
    echo "----------------------------------------" | tee -a "$LOG_FILE"
    
    # Run random search with robust mode and rolling windows
    python3 tools/backtest/run_random_search.py \
        --from "$FROM_DATE" \
        --to "$TO_DATE" \
        --trials 100 \
        --seed "$RUN_SEED" \
        --test-days 21 \
        --n-folds 10 \
        --robust \
        --top-n 30 \
        --n-clusters 3 \
        --validate-champions \
        --stress-lanes full \
        --output-dir "$OUTPUT_DIR" \
        --duckdb data/alerts.duckdb \
        2>&1 | tee -a "$LOG_FILE" "$OUTPUT_DIR/iter_${ITERATION}.log"
    
    ITERATION_END=$(date +%s)
    ITERATION_DURATION=$((ITERATION_END - ITERATION_START))
    ELAPSED=$((ITERATION_END - START_TIME))
    REMAINING=$((END_TIME - ITERATION_END))
    
    echo "Iteration $ITERATION completed in ${ITERATION_DURATION}s" | tee -a "$LOG_FILE"
    echo "Elapsed: $((ELAPSED / 60))m, Remaining: ~$((REMAINING / 60))m" | tee -a "$LOG_FILE"
    
    # Brief pause between iterations (5 seconds)
    sleep 5
done

FINAL_TIME=$(date +%s)
TOTAL_DURATION=$((FINAL_TIME - START_TIME))

echo "" | tee -a "$LOG_FILE"
echo "==========================================" | tee -a "$LOG_FILE"
echo "Loop Completed!" | tee -a "$LOG_FILE"
echo "Total iterations: $ITERATION" | tee -a "$LOG_FILE"
echo "Total duration: $((TOTAL_DURATION / 3600))h $(((TOTAL_DURATION % 3600) / 60))m" | tee -a "$LOG_FILE"
echo "Finished: $(date)" | tee -a "$LOG_FILE"
echo "==========================================" | tee -a "$LOG_FILE"

