#!/usr/bin/env bash
set -euo pipefail

# Compress Docker backup to save space
# Run with: ./scripts/system/compress-docker-backup.sh

BACKUP_DIR="/home/memez/docker-backup/20251228_224159"
COMPRESSED_FILE="/home/memez/docker-backup/20251228_224159.tar.gz"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Docker Backup Compression ===${NC}"
echo ""

# Check if backup directory exists
if [[ ! -d "$BACKUP_DIR" ]]; then
    echo -e "${RED}Error: Backup directory not found: $BACKUP_DIR${NC}"
    exit 1
fi

ORIGINAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
echo -e "${YELLOW}Original size: $ORIGINAL_SIZE${NC}"
echo -e "${YELLOW}Compressing to: $COMPRESSED_FILE${NC}"
echo ""

# Check available space
AVAILABLE=$(df -BG /home | tail -1 | awk '{print $4}' | sed 's/G//')
echo "Available space on /home: ${AVAILABLE}GB"
echo ""

read -p "Continue with compression? (yes/no): " -r
if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "Compression cancelled"
    exit 0
fi

echo ""
echo -e "${YELLOW}Compressing (this may take a while)...${NC}"
cd "$(dirname "$BACKUP_DIR")"
tar -czf "$COMPRESSED_FILE" "$(basename "$BACKUP_DIR")" 2>&1 | while IFS= read -r line; do
    echo "  $line"
done

if [[ -f "$COMPRESSED_FILE" ]]; then
    COMPRESSED_SIZE=$(du -sh "$COMPRESSED_FILE" | cut -f1)
    echo ""
    echo -e "${GREEN}=== Compression Complete ===${NC}"
    echo "Original size: $ORIGINAL_SIZE"
    echo "Compressed size: $COMPRESSED_SIZE"
    echo "Location: $COMPRESSED_FILE"
    echo ""
    echo "To extract:"
    echo "  tar -xzf $COMPRESSED_FILE"
    echo ""
    read -p "Delete original backup directory? (yes/no): " -r
    if [[ $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        rm -rf "$BACKUP_DIR"
        echo -e "${GREEN}✓ Original directory removed${NC}"
        echo "Space saved: $ORIGINAL_SIZE"
    else
        echo "Original directory kept"
    fi
else
    echo -e "${RED}Error: Compression failed${NC}"
    exit 1
fi


