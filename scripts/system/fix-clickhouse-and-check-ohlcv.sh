#!/usr/bin/env bash
set -euo pipefail

# Fix ClickHouse configuration and check for OHLCV data
# Run with: sudo ./scripts/system/fix-clickhouse-and-check-ohlcv.sh

CFG="/etc/clickhouse-server/config.xml"
CFG_DIST="/etc/clickhouse-server/config.xml.dpkg-dist"
BACKUP="/etc/clickhouse-server/config.xml.bak.$(date +%Y%m%d_%H%M%S)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== ClickHouse Fix and OHLCV Data Check ===${NC}"
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}Error: This script must be run as root (use sudo)${NC}"
   exit 1
fi

echo -e "${YELLOW}[1/8] Stopping clickhouse-server (if running)...${NC}"
systemctl stop clickhouse-server || true
sleep 2

echo -e "${YELLOW}[2/8] Ensuring log directory exists + perms...${NC}"
mkdir -p /var/log/clickhouse-server
chown -R clickhouse:clickhouse /var/log/clickhouse-server
chmod 750 /var/log/clickhouse-server

echo -e "${YELLOW}[3/8] Backing up current config to: $BACKUP${NC}"
cp -a "$CFG" "$BACKUP"
echo -e "${GREEN}✓ Config backed up${NC}"

echo -e "${YELLOW}[4/8] Installing xmllint if missing...${NC}"
if ! command -v xmllint >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y libxml2-utils
fi

echo -e "${YELLOW}[5/8] Fixing ClickHouse configuration...${NC}"

# Fix include_from path
if [ -f "/etc/clickhouse-server/config.d/clickhouse_remote_servers.xml" ]; then
  echo "  Found clickhouse_remote_servers.xml"
  # Ensure include_from points to config.d directory
  if ! grep -q "include_from.*config.d" "$CFG" 2>/dev/null; then
    echo "  Adding include_from to config.d directory..."
    # Add include_from after opening <clickhouse> tag if not present
    sed -i '/<clickhouse>/a\    <include_from>/etc/clickhouse-server/config.d/</include_from>' "$CFG"
  fi
else
  echo "  ⚠ clickhouse_remote_servers.xml not found, commenting out remote_servers"
  sed -i 's|<remote_servers incl="clickhouse_remote_servers" />|<!-- remote_servers removed: config not found -->|g' "$CFG" || true
fi

# Validate XML
echo "  Validating XML..."
if xmllint --noout "$CFG" >/dev/null 2>&1; then
  echo -e "  ${GREEN}✓ XML is valid${NC}"
else
  echo -e "  ${RED}✗ XML is INVALID${NC}"
  if [ -f "$CFG_DIST" ]; then
    echo "  Restoring from dpkg-dist..."
    cp -a "$CFG_DIST" "$CFG"
    if [ -f "/etc/clickhouse-server/config.d/clickhouse_remote_servers.xml" ]; then
      sed -i '/<clickhouse>/a\    <include_from>/etc/clickhouse-server/config.d/</include_from>' "$CFG"
    fi
  fi
fi

echo -e "${YELLOW}[6/8] Setting data paths to /home/memez/clickhouse-data...${NC}"
# Force paths into /home/memez/clickhouse-data/
perl -0777 -i -pe 's|<path>.*?</path>|<path>/home/memez/clickhouse-data/</path>|s' "$CFG" || true
perl -0777 -i -pe 's|<tmp_path>.*?</tmp_path>|<tmp_path>/home/memez/clickhouse-data/tmp/</tmp_path>|s' "$CFG" || true
perl -0777 -i -pe 's|<user_files_path>.*?</user_files_path>|<user_files_path>/home/memez/clickhouse-data/user_files/</user_files_path>|s' "$CFG" || true

# Ensure the dirs exist + owned by clickhouse
mkdir -p /home/memez/clickhouse-data/{tmp,user_files}
chown -R clickhouse:clickhouse /home/memez/clickhouse-data
echo -e "${GREEN}✓ Data paths configured${NC}"

echo -e "${YELLOW}[7/8] Configuring listen_host to 127.0.0.1...${NC}"
# Make listen_host explicit
perl -i -pe 's|^\s*<listen_host>.*?</listen_host>\s*$|<!-- removed by fix script -->|g' "$CFG"
perl -0777 -i -pe 's|(<tcp_port>9000</tcp_port>\s*)|$1\n    <listen_host>127.0.0.1</listen_host>\n|s' "$CFG"
echo -e "${GREEN}✓ Listen host configured${NC}"

# Final validation
echo "  Re-validating XML after edits..."
xmllint --noout "$CFG" && echo -e "  ${GREEN}✓ XML is valid${NC}" || echo -e "  ${YELLOW}⚠ XML validation failed but continuing...${NC}"

echo -e "${YELLOW}[8/8] Starting clickhouse-server...${NC}"
systemctl start clickhouse-server
sleep 5

echo ""
echo -e "${BLUE}=== ClickHouse Status ===${NC}"
systemctl status clickhouse-server --no-pager -l | head -15 || true

echo ""
echo -e "${BLUE}=== Listening Ports ===${NC}"
ss -ltnp | grep -E ':(9000|8123)\s' || echo "No ports found"

echo ""
echo -e "${BLUE}=== Connection Test ===${NC}"
if clickhouse-client --host 127.0.0.1 --port 9000 --query "SELECT version(), 1" 2>&1; then
  echo -e "${GREEN}✅ ClickHouse is working!${NC}"
else
  echo -e "${RED}❌ Connection failed${NC}"
  echo "Check logs: journalctl -u clickhouse-server -n 50"
  exit 1
fi

echo ""
echo -e "${BLUE}=== Checking for OHLCV Data ===${NC}"

# Check databases
echo "Databases:"
clickhouse-client --host 127.0.0.1 --port 9000 --query "SHOW DATABASES" 2>&1 || echo "Failed to list databases"

# Check if quantbot database exists
if clickhouse-client --host 127.0.0.1 --port 9000 --query "EXISTS DATABASE quantbot" 2>&1 | grep -q "1"; then
  echo ""
  echo -e "${GREEN}✓ quantbot database exists${NC}"
  
  # Check tables
  echo "Tables in quantbot:"
  clickhouse-client --host 127.0.0.1 --port 9000 --query "SHOW TABLES FROM quantbot" 2>&1 || echo "Failed to list tables"
  
  # Check ohlcv_candles
  if clickhouse-client --host 127.0.0.1 --port 9000 --query "EXISTS TABLE quantbot.ohlcv_candles" 2>&1 | grep -q "1"; then
    echo ""
    echo -e "${GREEN}✓ ohlcv_candles table exists${NC}"
    
    # Get row count
    echo "Checking row count..."
    ROW_COUNT=$(clickhouse-client --host 127.0.0.1 --port 9000 --query "SELECT COUNT(*) FROM quantbot.ohlcv_candles" 2>&1 || echo "0")
    echo "  Total rows: $ROW_COUNT"
    
    if [[ "$ROW_COUNT" != "0" ]] && [[ "$ROW_COUNT" != *"Exception"* ]]; then
      echo ""
      echo -e "${GREEN}🎉 OHLCV DATA FOUND!${NC}"
      
      # Get date range
      echo "Date range:"
      clickhouse-client --host 127.0.0.1 --port 9000 --query "SELECT min(timestamp) as oldest, max(timestamp) as newest FROM quantbot.ohlcv_candles" 2>&1 || true
      
      # Get unique tokens
      echo "Unique tokens:"
      clickhouse-client --host 127.0.0.1 --port 9000 --query "SELECT COUNT(DISTINCT token_address) as unique_tokens FROM quantbot.ohlcv_candles" 2>&1 || true
      
      # Get data by interval
      echo "Data by interval:"
      clickhouse-client --host 127.0.0.1 --port 9000 --query "SELECT \`interval\`, COUNT(*) as candle_count, formatReadableSize(sum(bytes)) as size FROM system.parts WHERE database = 'quantbot' AND table = 'ohlcv_candles' AND active GROUP BY \`interval\` ORDER BY candle_count DESC" 2>&1 || true
      
      # Get total size
      echo "Total table size:"
      clickhouse-client --host 127.0.0.1 --port 9000 --query "SELECT formatReadableSize(sum(bytes)) as size, sum(rows) as total_rows FROM system.parts WHERE database = 'quantbot' AND table = 'ohlcv_candles' AND active" 2>&1 || true
      
      echo ""
      echo -e "${GREEN}✅ OHLCV candle data is available in ClickHouse!${NC}"
    else
      echo -e "${YELLOW}⚠ ohlcv_candles table exists but is empty (0 rows)${NC}"
    fi
  else
    echo -e "${YELLOW}⚠ ohlcv_candles table does not exist${NC}"
  fi
else
  echo -e "${YELLOW}⚠ quantbot database does not exist${NC}"
fi

echo ""
echo -e "${BLUE}=== Summary ===${NC}"
echo "Config backup: $BACKUP"
echo "Data directory: /home/memez/clickhouse-data"
echo ""
echo "To query OHLCV data:"
echo "  clickhouse-client --host 127.0.0.1 --port 9000 --query \"SELECT COUNT(*) FROM quantbot.ohlcv_candles\""


