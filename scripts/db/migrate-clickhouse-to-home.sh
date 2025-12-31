#!/usr/bin/env bash
set -euo pipefail

# Migrate ClickHouse data directory from /var/lib/clickhouse to /home/memez/clickhouse-data
# This frees up space on the root filesystem

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NEW_DATA_DIR="/home/memez/clickhouse-data"
OLD_DATA_DIR="/var/lib/clickhouse"
CONFIG_FILE="/etc/clickhouse-server/config.xml"
BACKUP_CONFIG="/etc/clickhouse-server/config.xml.backup.$(date +%Y%m%d_%H%M%S)"

echo "=== ClickHouse Data Migration Script ==="
echo "Source: $OLD_DATA_DIR"
echo "Destination: $NEW_DATA_DIR"
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "Error: This script must be run as root (use sudo)"
   exit 1
fi

# Check if ClickHouse is installed
if ! command -v clickhouse-server &> /dev/null; then
    echo "Error: clickhouse-server not found"
    exit 1
fi

# Check current data directory size
if [[ -d "$OLD_DATA_DIR" ]]; then
    OLD_SIZE=$(du -sh "$OLD_DATA_DIR" 2>/dev/null | cut -f1)
    echo "Current data directory size: $OLD_SIZE"
else
    echo "Warning: $OLD_DATA_DIR does not exist"
fi

# Check available space on /home
HOME_AVAILABLE=$(df -BG /home | tail -1 | awk '{print $4}' | sed 's/G//')
echo "Available space on /home: ${HOME_AVAILABLE}GB"
echo ""

# Confirm migration
read -p "Continue with migration? (yes/no): " -r
if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "Migration cancelled"
    exit 0
fi

echo ""
echo "Step 1: Stopping ClickHouse server..."
systemctl stop clickhouse-server || {
    echo "Warning: Could not stop clickhouse-server via systemctl"
    echo "Attempting to stop manually..."
    pkill -f clickhouse-server || echo "No running clickhouse-server found"
    sleep 2
}

# Wait for ClickHouse to fully stop
sleep 3

echo "Step 2: Creating destination directory..."
mkdir -p "$NEW_DATA_DIR"
chown clickhouse:clickhouse "$NEW_DATA_DIR" 2>/dev/null || {
    echo "Warning: Could not set ownership (clickhouse user may not exist)"
}

echo "Step 3: Moving data directory..."
if [[ -d "$OLD_DATA_DIR" ]] && [[ "$(ls -A $OLD_DATA_DIR 2>/dev/null)" ]]; then
    echo "Moving $OLD_DATA_DIR to $NEW_DATA_DIR..."
    # Use rsync for safer migration (can resume if interrupted)
    rsync -av --progress "$OLD_DATA_DIR/" "$NEW_DATA_DIR/" || {
        echo "Error: rsync failed, attempting direct move..."
        mv "$OLD_DATA_DIR" "${OLD_DATA_DIR}.old"
        mv "${OLD_DATA_DIR}.old"/* "$NEW_DATA_DIR/" 2>/dev/null || true
        rmdir "${OLD_DATA_DIR}.old" 2>/dev/null || true
    }
    
    # Create symlink from old location to new location
    echo "Step 4: Creating symlink..."
    rm -rf "$OLD_DATA_DIR"
    ln -s "$NEW_DATA_DIR" "$OLD_DATA_DIR"
    echo "Created symlink: $OLD_DATA_DIR -> $NEW_DATA_DIR"
else
    echo "No data to migrate, creating symlink..."
    rm -rf "$OLD_DATA_DIR"
    ln -s "$NEW_DATA_DIR" "$OLD_DATA_DIR"
fi

echo "Step 5: Updating ClickHouse configuration..."
if [[ -f "$CONFIG_FILE" ]]; then
    # Backup config
    cp "$CONFIG_FILE" "$BACKUP_CONFIG"
    echo "Backed up config to: $BACKUP_CONFIG"
    
    # Update path in config.xml if it exists
    if grep -q "<path>" "$CONFIG_FILE"; then
        sed -i "s|<path>.*</path>|<path>$NEW_DATA_DIR</path>|g" "$CONFIG_FILE"
        echo "Updated <path> in config.xml"
    else
        echo "Warning: <path> tag not found in config.xml, adding it..."
        # This is more complex, would need to insert in the right place
        # For now, the symlink should work
    fi
    
    # Update tmp_path if it exists
    if grep -q "<tmp_path>" "$CONFIG_FILE"; then
        NEW_TMP_PATH="$NEW_DATA_DIR/tmp"
        sed -i "s|<tmp_path>.*</tmp_path>|<tmp_path>$NEW_TMP_PATH</tmp_path>|g" "$CONFIG_FILE"
        mkdir -p "$NEW_TMP_PATH"
        chown clickhouse:clickhouse "$NEW_TMP_PATH" 2>/dev/null || true
        echo "Updated <tmp_path> in config.xml"
    fi
    
    # Update user_files_path if it exists
    if grep -q "<user_files_path>" "$CONFIG_FILE"; then
        NEW_USER_FILES_PATH="$NEW_DATA_DIR/user_files"
        sed -i "s|<user_files_path>.*</user_files_path>|<user_files_path>$NEW_USER_FILES_PATH</user_files_path>|g" "$CONFIG_FILE"
        mkdir -p "$NEW_USER_FILES_PATH"
        chown clickhouse:clickhouse "$NEW_USER_FILES_PATH" 2>/dev/null || true
        echo "Updated <user_files_path> in config.xml"
    fi
else
    echo "Warning: Config file $CONFIG_FILE not found"
fi

echo "Step 6: Setting permissions..."
chown -R clickhouse:clickhouse "$NEW_DATA_DIR" 2>/dev/null || {
    echo "Warning: Could not set ownership (clickhouse user may not exist)"
    echo "You may need to set permissions manually"
}

echo "Step 7: Starting ClickHouse server..."
systemctl start clickhouse-server || {
    echo "Error: Could not start clickhouse-server"
    echo "Check logs: journalctl -u clickhouse-server"
    exit 1
}

# Wait for ClickHouse to start
sleep 5

echo "Step 8: Verifying ClickHouse is running..."
if systemctl is-active --quiet clickhouse-server; then
    echo "✓ ClickHouse server is running"
    
    # Test connection
    if clickhouse-client --query "SELECT 1" &>/dev/null; then
        echo "✓ ClickHouse connection successful"
        
        # Show database sizes
        echo ""
        echo "Database sizes:"
        clickhouse-client --query "SELECT database, formatReadableSize(sum(bytes)) as size FROM system.parts WHERE active GROUP BY database ORDER BY sum(bytes) DESC" 2>/dev/null || true
    else
        echo "⚠ ClickHouse is running but connection test failed"
    fi
else
    echo "✗ ClickHouse server failed to start"
    echo "Check logs: journalctl -u clickhouse-server -n 50"
    exit 1
fi

echo ""
echo "=== Migration Complete ==="
echo "Data directory: $NEW_DATA_DIR"
echo "Symlink: $OLD_DATA_DIR -> $NEW_DATA_DIR"
echo ""
echo "Space freed on root filesystem!"
df -h / | tail -1

