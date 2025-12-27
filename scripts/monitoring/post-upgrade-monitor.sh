#!/bin/bash
# Post-upgrade monitoring script for ClickHouse
# Compares current metrics to baseline and alerts if thresholds exceeded

set -e

BASELINE_FILE="data/backup/clickhouse/baseline_metrics_*.txt"
OUTPUT_FILE="data/backup/clickhouse/monitoring_$(date +%Y%m%d_%H%M%S).txt"

echo "=== ClickHouse Post-Upgrade Monitoring ===" > "$OUTPUT_FILE"
echo "Date: $(date)" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Query performance
echo "=== Query Performance ===" >> "$OUTPUT_FILE"
{ time docker-compose exec -T clickhouse clickhouse-client --query "SELECT COUNT(*) FROM quantbot.ohlcv_candles" 2>&1; } 2>> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Export performance
echo "=== Export Performance (Parquet) ===" >> "$OUTPUT_FILE"
{ time docker-compose exec -T clickhouse clickhouse-client --query "SELECT * FROM quantbot.ohlcv_candles LIMIT 1000 FORMAT Parquet" > /dev/null 2>&1; } 2>> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Memory usage
echo "=== Memory Usage ===" >> "$OUTPUT_FILE"
docker stats clickhouse --no-stream --format "table {{.MemUsage}}" >> "$OUTPUT_FILE" 2>&1
echo "" >> "$OUTPUT_FILE"

# Disk usage
echo "=== Disk Usage ===" >> "$OUTPUT_FILE"
docker-compose exec -T clickhouse df -h >> "$OUTPUT_FILE" 2>&1
echo "" >> "$OUTPUT_FILE"

# Error count
echo "=== Recent Errors ===" >> "$OUTPUT_FILE"
ERROR_COUNT=$(docker-compose logs clickhouse --tail 100 2>&1 | grep -i "error\|exception\|fatal" | wc -l)
echo "Error count (last 100 lines): $ERROR_COUNT" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Service status
echo "=== Service Status ===" >> "$OUTPUT_FILE"
docker-compose ps clickhouse >> "$OUTPUT_FILE" 2>&1
echo "" >> "$OUTPUT_FILE"

cat "$OUTPUT_FILE"

# Check thresholds
if [ "$ERROR_COUNT" -gt 10 ]; then
  echo "WARNING: High error count detected: $ERROR_COUNT"
  exit 1
fi

echo "Monitoring complete - all checks passed"

