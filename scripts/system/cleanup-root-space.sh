#!/usr/bin/env bash
set -euo pipefail

# Cleanup script to free up space on root filesystem
# Run with: sudo ./scripts/system/cleanup-root-space.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRY_RUN="${1:-}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}Error: This script must be run as root (use sudo)${NC}"
   exit 1
fi

# Function to get size before cleanup
get_size() {
    local path="$1"
    if [[ -d "$path" ]] || [[ -f "$path" ]]; then
        du -sh "$path" 2>/dev/null | cut -f1 || echo "0"
    else
        echo "0"
    fi
}

# Function to calculate space freed
calculate_space() {
    local path="$1"
    local before=$(du -sb "$path" 2>/dev/null | cut -f1 || echo 0)
    echo "$before"
}

echo "=== Root Filesystem Cleanup Script ==="
echo ""
df -h / | tail -1
echo ""

TOTAL_FREED=0

# 1. Clean journal logs (systemd logs)
echo -e "${YELLOW}[1/10] Cleaning systemd journal logs...${NC}"
JOURNAL_BEFORE=$(journalctl --disk-usage 2>/dev/null | grep -oP '\d+\.\d+\w+' || echo "0")
if [[ "$JOURNAL_BEFORE" != "0" ]]; then
    echo "  Current journal size: $JOURNAL_BEFORE"
    if [[ "$DRY_RUN" != "dry-run" ]]; then
        journalctl --vacuum-time=3d --vacuum-size=500M 2>/dev/null || true
        JOURNAL_AFTER=$(journalctl --disk-usage 2>/dev/null | grep -oP '\d+\.\d+\w+' || echo "0")
        echo -e "  ${GREEN}✓ Cleaned journal logs${NC}"
    else
        echo "  [DRY RUN] Would clean journal logs (keep 3 days, max 500MB)"
    fi
else
    echo "  No journal logs to clean"
fi
echo ""

# 2. Clean apt cache
echo -e "${YELLOW}[2/10] Cleaning apt package cache...${NC}"
APT_SIZE=$(get_size /var/cache/apt)
if [[ "$APT_SIZE" != "0" ]] && [[ "$APT_SIZE" != "" ]]; then
    echo "  Current apt cache size: $APT_SIZE"
    if [[ "$DRY_RUN" != "dry-run" ]]; then
        apt-get clean -y 2>/dev/null || true
        apt-get autoclean -y 2>/dev/null || true
        echo -e "  ${GREEN}✓ Cleaned apt cache${NC}"
    else
        echo "  [DRY RUN] Would clean apt cache"
    fi
else
    echo "  Apt cache already clean"
fi
echo ""

# 3. Remove old kernels (keep current + 1 previous)
echo -e "${YELLOW}[3/10] Checking for old kernels...${NC}"
CURRENT_KERNEL=$(uname -r)
KERNEL_COUNT=$(dpkg -l | grep -E "^ii.*linux-image" | wc -l)
echo "  Current kernel: $CURRENT_KERNEL"
echo "  Installed kernels: $KERNEL_COUNT"
if [[ $KERNEL_COUNT -gt 2 ]]; then
    if [[ "$DRY_RUN" != "dry-run" ]]; then
        OLD_KERNELS=$(dpkg -l | grep -E "^ii.*linux-image" | grep -v "$CURRENT_KERNEL" | awk '{print $2}' | head -n -1)
        if [[ -n "$OLD_KERNELS" ]]; then
            echo "  Removing old kernels..."
            for kernel in $OLD_KERNELS; do
                apt-get remove --purge -y "$kernel" 2>/dev/null || true
            done
            echo -e "  ${GREEN}✓ Removed old kernels${NC}"
        fi
    else
        echo "  [DRY RUN] Would remove old kernels (keep current + 1 previous)"
    fi
else
    echo "  Only essential kernels installed, skipping"
fi
echo ""

# 4. Clean /var/log
echo -e "${YELLOW}[4/10] Cleaning /var/log directory...${NC}"
VAR_LOG_SIZE=$(get_size /var/log)
echo "  Current /var/log size: $VAR_LOG_SIZE"
if [[ "$DRY_RUN" != "dry-run" ]]; then
    # Remove old log files (older than 7 days)
    find /var/log -type f -name "*.log" -mtime +7 -delete 2>/dev/null || true
    find /var/log -type f -name "*.gz" -mtime +30 -delete 2>/dev/null || true
    find /var/log -type f -name "*.old" -mtime +30 -delete 2>/dev/null || true
    # Truncate large log files (keep last 1000 lines)
    find /var/log -type f -name "*.log" -size +100M -exec sh -c 'tail -1000 "$1" > "$1.tmp" && mv "$1.tmp" "$1"' _ {} \; 2>/dev/null || true
    echo -e "  ${GREEN}✓ Cleaned /var/log${NC}"
else
    echo "  [DRY RUN] Would clean old log files (>7 days) and truncate large logs"
fi
echo ""

# 5. Clean /tmp
echo -e "${YELLOW}[5/10] Cleaning /tmp directory...${NC}"
TMP_SIZE=$(get_size /tmp)
echo "  Current /tmp size: $TMP_SIZE"
if [[ "$DRY_RUN" != "dry-run" ]]; then
    # Remove files older than 7 days
    find /tmp -type f -atime +7 -delete 2>/dev/null || true
    find /tmp -type d -empty -delete 2>/dev/null || true
    echo -e "  ${GREEN}✓ Cleaned /tmp${NC}"
else
    echo "  [DRY RUN] Would remove files older than 7 days from /tmp"
fi
echo ""

# 6. Clean package manager caches
echo -e "${YELLOW}[6/10] Cleaning package manager caches...${NC}"

# pip cache (if exists)
if [[ -d /root/.cache/pip ]]; then
    PIP_SIZE=$(get_size /root/.cache/pip)
    echo "  pip cache: $PIP_SIZE"
    if [[ "$DRY_RUN" != "dry-run" ]]; then
        rm -rf /root/.cache/pip/* 2>/dev/null || true
        echo -e "  ${GREEN}✓ Cleaned pip cache${NC}"
    fi
fi

# npm cache (if exists)
if [[ -d /root/.npm ]]; then
    NPM_SIZE=$(get_size /root/.npm)
    echo "  npm cache: $NPM_SIZE"
    if [[ "$DRY_RUN" != "dry-run" ]]; then
        npm cache clean --force 2>/dev/null || true
        echo -e "  ${GREEN}✓ Cleaned npm cache${NC}"
    fi
fi

# pnpm cache (if exists)
if [[ -d /root/.cache/pnpm ]]; then
    PNPM_SIZE=$(get_size /root/.cache/pnpm)
    echo "  pnpm cache: $PNPM_SIZE"
    if [[ "$DRY_RUN" != "dry-run" ]]; then
        rm -rf /root/.cache/pnpm/* 2>/dev/null || true
        echo -e "  ${GREEN}✓ Cleaned pnpm cache${NC}"
    fi
fi
echo ""

# 7. Remove orphaned packages
echo -e "${YELLOW}[7/10] Checking for orphaned packages...${NC}"
ORPHANED=$(dpkg -l | grep -E "^rc" | wc -l)
if [[ $ORPHANED -gt 0 ]]; then
    echo "  Found $ORPHANED orphaned packages"
    if [[ "$DRY_RUN" != "dry-run" ]]; then
        dpkg -l | grep -E "^rc" | awk '{print $2}' | xargs -r apt-get purge -y 2>/dev/null || true
        echo -e "  ${GREEN}✓ Removed orphaned packages${NC}"
    else
        echo "  [DRY RUN] Would remove $ORPHANED orphaned packages"
    fi
else
    echo "  No orphaned packages found"
fi
echo ""

# 8. Clean /var/cache
echo -e "${YELLOW}[8/10] Cleaning /var/cache...${NC}"
VAR_CACHE_SIZE=$(get_size /var/cache)
echo "  Current /var/cache size: $VAR_CACHE_SIZE"
if [[ "$DRY_RUN" != "dry-run" ]]; then
    # Clean various caches
    find /var/cache -type f -atime +30 -delete 2>/dev/null || true
    find /var/cache -type d -empty -delete 2>/dev/null || true
    echo -e "  ${GREEN}✓ Cleaned /var/cache${NC}"
else
    echo "  [DRY RUN] Would remove files older than 30 days from /var/cache"
fi
echo ""

# 9. Find and report large files
echo -e "${YELLOW}[9/10] Finding large files (>500MB) in /var...${NC}"
LARGE_FILES=$(find /var -type f -size +500M 2>/dev/null | head -10 || true)
if [[ -n "$LARGE_FILES" ]]; then
    echo "  Large files found:"
    for file in $LARGE_FILES; do
        SIZE=$(du -sh "$file" 2>/dev/null | cut -f1 || echo "unknown")
        echo "    $SIZE - $file"
    done
    echo "  ${YELLOW}Note: Review these files manually before deleting${NC}"
else
    echo "  No unusually large files found"
fi
echo ""

# 10. Clean thumbnails and temporary user files
echo -e "${YELLOW}[10/10] Cleaning user caches and thumbnails...${NC}"
if [[ "$DRY_RUN" != "dry-run" ]]; then
    # Clean thumbnails for all users
    for home in /home/*; do
        if [[ -d "$home/.cache/thumbnails" ]]; then
            rm -rf "$home/.cache/thumbnails"/* 2>/dev/null || true
        fi
    done
    echo -e "  ${GREEN}✓ Cleaned thumbnails${NC}"
else
    echo "  [DRY RUN] Would clean thumbnail caches"
fi
echo ""

# Summary
echo "=== Cleanup Complete ==="
echo ""
echo "Disk space after cleanup:"
df -h / | tail -1
echo ""
echo -e "${GREEN}✓ All cleanup tasks completed${NC}"
echo ""
echo "To see what would be cleaned without actually cleaning, run:"
echo "  sudo $0 dry-run"

