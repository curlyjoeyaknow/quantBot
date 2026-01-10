#!/bin/bash
# Emergency rollback script for ClickHouse upgrade
# Usage: ./scripts/rollback/rollback-clickhouse.sh [scenario]
# Scenarios: upgrade-failed, data-corruption, service-down, code-issues

set -e

SCENARIO=${1:-upgrade-failed}
BACKUP_DIR="data/backup/clickhouse"

echo "Starting rollback procedure for scenario: $SCENARIO"

case $SCENARIO in
  upgrade-failed|service-down)
    echo "Reverting docker-compose.yml..."
    git checkout HEAD -- docker-compose.yml
    docker-compose stop clickhouse
    docker-compose up -d clickhouse
    echo "Waiting for service to start..."
    sleep 10
    docker-compose exec clickhouse clickhouse-client --query "SELECT 1"
    echo "Rollback complete - service restarted with previous version"
    ;;
  data-corruption)
    echo "Attempting restore from cloned database first..."
    BACKUP_DB=$(grep "Backup database:" ${BACKUP_DIR}/README.md 2>/dev/null | cut -d: -f2 | tr -d ' ' || echo "")
    if [ -n "$BACKUP_DB" ] && docker-compose exec -T clickhouse clickhouse-client --query "EXISTS DATABASE ${BACKUP_DB}" 2>&1 | grep -q "1"; then
      echo "Restoring from cloned database: ${BACKUP_DB}"
      # Restore from cloned database (fast)
      BACKUP_TABLES=$(docker-compose exec -T clickhouse clickhouse-client --query "SHOW TABLES FROM ${BACKUP_DB}" 2>&1 | grep -v "^$" | tr '\n' ' ')
      for TABLE in $BACKUP_TABLES; do
        if [ -n "$TABLE" ] && [ "$TABLE" != " " ]; then
          echo "Restoring table: ${TABLE}"
          docker-compose exec clickhouse clickhouse-client --query "DROP TABLE IF EXISTS quantbot.${TABLE}" 2>&1
          TABLE_DDL=$(docker-compose exec -T clickhouse clickhouse-client --query "SHOW CREATE TABLE ${BACKUP_DB}.${TABLE}" 2>&1)
          echo "${TABLE_DDL}" | sed "s/${BACKUP_DB}\.${TABLE}/quantbot.${TABLE}/g" | docker-compose exec -T clickhouse clickhouse-client 2>&1
          docker-compose exec clickhouse clickhouse-client --query "INSERT INTO quantbot.${TABLE} SELECT * FROM ${BACKUP_DB}.${TABLE}" 2>&1
          echo "✓ ${TABLE} restored"
        fi
      done
      echo "Restore from cloned database complete"
    else
      echo "Cloned database not found, using file-based restore..."
      echo "WARNING: This will delete all ClickHouse data!"
      read -p "Are you sure? Type 'yes' to continue: " confirm
      if [ "$confirm" != "yes" ]; then
        echo "Rollback cancelled"
        exit 1
      fi
      docker-compose stop clickhouse
      git checkout HEAD -- docker-compose.yml
      docker volume rm quantbot_clickhouse-data || true
      docker-compose up -d clickhouse
      sleep 10
      # Restore schema and data from files (see Scenario B Option 2)
      echo "Restoring from file backups..."
      BACKUP_DATE=$(grep "Backup database:" ${BACKUP_DIR}/README.md 2>/dev/null | grep -o '[0-9]\{8\}' | head -1 || echo "")
      if [ -n "$BACKUP_DATE" ]; then
        docker-compose exec clickhouse clickhouse-client < ${BACKUP_DIR}/schema_database_${BACKUP_DATE}.sql 2>&1
        for SCHEMA_FILE in ${BACKUP_DIR}/schema_*_${BACKUP_DATE}.sql; do
          if [ -f "$SCHEMA_FILE" ] && [[ "$SCHEMA_FILE" != *"schema_database"* ]]; then
            TABLE_NAME=$(basename "$SCHEMA_FILE" | sed 's/schema_\(.*\)_[0-9]*\.sql/\1/')
            echo "Restoring schema for ${TABLE_NAME}..."
            docker-compose exec clickhouse clickhouse-client < "$SCHEMA_FILE" 2>&1
          fi
        done
        for CSV_FILE in ${BACKUP_DIR}/data_*_${BACKUP_DATE}.csv; do
          if [ -f "$CSV_FILE" ]; then
            TABLE_NAME=$(basename "$CSV_FILE" | sed "s/data_\(.*\)_${BACKUP_DATE}\.csv/\1/")
            echo "Restoring data for ${TABLE_NAME}..."
            docker-compose exec -T clickhouse clickhouse-client --query "INSERT INTO quantbot.${TABLE_NAME} FORMAT CSV" < "$CSV_FILE" 2>&1
          fi
        done
      fi
    fi
    ;;
  code-issues)
    echo "Reverting code changes only..."
    git checkout HEAD -- packages/storage/src/adapters/clickhouse-slice-exporter-adapter-impl.ts
    pnpm build
    echo "Code rollback complete - rebuild required"
    ;;
  *)
    echo "Unknown scenario: $SCENARIO"
    echo "Valid scenarios: upgrade-failed, data-corruption, service-down, code-issues"
    exit 1
    ;;
esac

echo "Rollback procedure completed successfully"

