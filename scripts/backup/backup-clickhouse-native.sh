#!/bin/bash
# Backup Data using ClickHouse BACKUP command (additional safety)
# Usage: ./scripts/backup/backup-clickhouse-native.sh [BACKUP_DATE]

set -e

BACKUP_DATE=${1:-$(date +%Y%m%d)}
BACKUP_NAME="quantbot_backup_${BACKUP_DATE}"

echo "Creating ClickHouse BACKUP: ${BACKUP_NAME}"

# Note: ClickHouse BACKUP command requires a configured disk
# Check if 'backups' disk is configured, otherwise use default
BACKUP_RESULT=$(docker-compose exec -T clickhouse clickhouse-client --query "BACKUP DATABASE quantbot TO Disk('backups', '${BACKUP_NAME}')" 2>&1 || true)

if echo "$BACKUP_RESULT" | grep -q "BACKUP"; then
    echo "✓ ClickHouse BACKUP created successfully"
    echo "  Backup name: ${BACKUP_NAME}"
    echo "  Note: Check ClickHouse logs for backup location"
    
    # Try to get backup status
    BACKUP_STATUS=$(docker-compose exec -T clickhouse clickhouse-client --query "SELECT * FROM system.backups WHERE name = '${BACKUP_NAME}' ORDER BY id DESC LIMIT 1" 2>&1 || echo "")
    if [ -n "$BACKUP_STATUS" ] && [ "$BACKUP_STATUS" != "" ]; then
        echo "  Backup status:"
        echo "$BACKUP_STATUS"
    fi
else
    echo "WARNING: ClickHouse BACKUP command may have failed or 'backups' disk not configured"
    echo "  Error output: $BACKUP_RESULT"
    echo "  This is optional - other backup methods are still available"
    echo ""
    echo "  To configure backup disk, add to ClickHouse config.xml:"
    echo "    <backups>"
    echo "      <backup_disk>backups</backup_disk>"
    echo "    </backups>"
    echo "    <storage_configuration>"
    echo "      <disks>"
    echo "        <backups>"
    echo "          <path>/var/lib/clickhouse/backups/</path>"
    echo "        </backups>"
    echo "      </disks>"
    echo "    </storage_configuration>"
fi

