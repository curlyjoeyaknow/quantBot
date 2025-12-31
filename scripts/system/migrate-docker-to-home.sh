#!/usr/bin/env bash
set -euo pipefail

# Migrate Docker data directory from /var/lib/docker to /home/memez/docker-data
# This frees up space on the root filesystem permanently
# Run with: sudo ./scripts/system/migrate-docker-to-home.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NEW_DOCKER_DIR="/home/memez/docker-data"
OLD_DOCKER_DIR="/var/lib/docker"
DOCKER_CONFIG="/etc/docker/daemon.json"
BACKUP_CONFIG="/etc/docker/daemon.json.backup.$(date +%Y%m%d_%H%M%S)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Docker Data Migration Script ===${NC}"
echo "Source: $OLD_DOCKER_DIR"
echo "Destination: $NEW_DOCKER_DIR"
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}Error: This script must be run as root (use sudo)${NC}"
   exit 1
fi

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed${NC}"
    exit 1
fi

# Check current Docker data directory size
if [[ -d "$OLD_DOCKER_DIR" ]]; then
    OLD_SIZE=$(du -sh "$OLD_DOCKER_DIR" 2>/dev/null | cut -f1)
    echo "Current Docker data directory size: $OLD_SIZE"
else
    echo "Warning: $OLD_DOCKER_DIR does not exist"
fi

# Check available space on /home
HOME_AVAILABLE=$(df -BG /home | tail -1 | awk '{print $4}' | sed 's/G//')
echo "Available space on /home: ${HOME_AVAILABLE}GB"
echo ""

# Confirm migration
read -p "Continue with migration? This will stop all Docker containers. (yes/no): " -r
if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "Migration cancelled"
    exit 0
fi

echo ""
echo -e "${YELLOW}Step 1: Stopping Docker service...${NC}"
systemctl stop docker || {
    echo -e "${RED}Error: Could not stop Docker service${NC}"
    exit 1
}

# Wait for Docker to fully stop
sleep 3

echo -e "${YELLOW}Step 2: Creating destination directory...${NC}"
mkdir -p "$NEW_DOCKER_DIR"
chown root:root "$NEW_DOCKER_DIR"

echo -e "${YELLOW}Step 3: Moving Docker data directory...${NC}"
if [[ -d "$OLD_DOCKER_DIR" ]] && [[ "$(ls -A $OLD_DOCKER_DIR 2>/dev/null)" ]]; then
    echo "Moving $OLD_DOCKER_DIR to $NEW_DOCKER_DIR..."
    # Use rsync for safer migration (can resume if interrupted)
    rsync -av --progress "$OLD_DOCKER_DIR/" "$NEW_DOCKER_DIR/" || {
        echo -e "${RED}Error: rsync failed${NC}"
        echo "Attempting direct move..."
        mv "$OLD_DOCKER_DIR" "${OLD_DOCKER_DIR}.old"
        mv "${OLD_DOCKER_DIR}.old"/* "$NEW_DOCKER_DIR/" 2>/dev/null || true
        rmdir "${OLD_DOCKER_DIR}.old" 2>/dev/null || true
    }
    
    # Create symlink from old location to new location
    echo -e "${YELLOW}Step 4: Creating symlink...${NC}"
    rm -rf "$OLD_DOCKER_DIR"
    ln -s "$NEW_DOCKER_DIR" "$OLD_DOCKER_DIR"
    echo -e "${GREEN}Created symlink: $OLD_DOCKER_DIR -> $NEW_DOCKER_DIR${NC}"
else
    echo "No data to migrate, creating symlink..."
    rm -rf "$OLD_DOCKER_DIR"
    ln -s "$NEW_DOCKER_DIR" "$OLD_DOCKER_DIR"
fi

echo -e "${YELLOW}Step 5: Updating Docker daemon configuration...${NC}"
# Create /etc/docker directory if it doesn't exist
mkdir -p /etc/docker

# Backup existing config if it exists
if [[ -f "$DOCKER_CONFIG" ]]; then
    cp "$DOCKER_CONFIG" "$BACKUP_CONFIG"
    echo "Backed up config to: $BACKUP_CONFIG"
    
    # Update data-root in existing config
    if grep -q '"data-root"' "$DOCKER_CONFIG"; then
        # Update existing data-root
        sed -i "s|\"data-root\":.*|\"data-root\": \"$NEW_DOCKER_DIR\",|g" "$DOCKER_CONFIG"
        echo "Updated data-root in existing daemon.json"
    else
        # Add data-root to existing config (preserve other settings)
        # This is tricky with JSON, so we'll use a Python one-liner
        python3 <<PYTHON_SCRIPT
import json
import sys

try:
    with open("$DOCKER_CONFIG", "r") as f:
        config = json.load(f)
except:
    config = {}

config["data-root"] = "$NEW_DOCKER_DIR"

with open("$DOCKER_CONFIG", "w") as f:
    json.dump(config, f, indent=2)
PYTHON_SCRIPT
        echo "Added data-root to existing daemon.json"
    fi
else
    # Create new config file
    cat > "$DOCKER_CONFIG" <<EOF
{
  "data-root": "$NEW_DOCKER_DIR"
}
EOF
    echo "Created new daemon.json with data-root"
fi

echo -e "${YELLOW}Step 6: Setting permissions...${NC}"
chown -R root:root "$NEW_DOCKER_DIR"

echo -e "${YELLOW}Step 7: Starting Docker service...${NC}"
systemctl start docker || {
    echo -e "${RED}Error: Could not start Docker service${NC}"
    echo "Check logs: journalctl -u docker -n 50"
    exit 1
}

# Wait for Docker to start
sleep 5

echo -e "${YELLOW}Step 8: Verifying Docker is running...${NC}"
if systemctl is-active --quiet docker; then
    echo -e "${GREEN}✓ Docker service is running${NC}"
    
    # Test Docker
    if docker ps &>/dev/null; then
        echo -e "${GREEN}✓ Docker is working correctly${NC}"
        
        # Show containers
        echo ""
        echo "Running containers:"
        docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
    else
        echo -e "${YELLOW}⚠ Docker is running but connection test failed${NC}"
    fi
else
    echo -e "${RED}✗ Docker service failed to start${NC}"
    echo "Check logs: journalctl -u docker -n 50"
    exit 1
fi

echo ""
echo -e "${GREEN}=== Migration Complete ===${NC}"
echo "Docker data directory: $NEW_DOCKER_DIR"
echo "Symlink: $OLD_DOCKER_DIR -> $NEW_DOCKER_DIR"
echo "Config: $DOCKER_CONFIG"
echo ""
echo -e "${GREEN}Space freed on root filesystem!${NC}"
df -h / | tail -1

