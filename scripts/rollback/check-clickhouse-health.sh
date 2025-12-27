#!/bin/bash
# Health check script for ClickHouse - can be run by monitoring
# Returns 0 if healthy, 1 if unhealthy

# Check if container is running
if ! docker-compose ps clickhouse 2>&1 | grep -q "Up"; then
  echo "ERROR: ClickHouse container is not running"
  exit 1
fi

# Check if service responds
if ! docker-compose exec -T clickhouse clickhouse-client --query "SELECT 1" > /dev/null 2>&1; then
  echo "ERROR: ClickHouse is not responding to queries"
  exit 1
fi

# Check for recent errors in logs
ERROR_COUNT=$(docker-compose logs clickhouse --tail 100 2>&1 | grep -i "error\|exception\|fatal" | wc -l)
if [ "$ERROR_COUNT" -gt 10 ]; then
  echo "WARNING: High error count in logs: $ERROR_COUNT"
  exit 1
fi

echo "ClickHouse is healthy"
exit 0

