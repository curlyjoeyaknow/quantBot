#!/usr/bin/env bash
set -euo pipefail

# Fix ClickHouse - remove include_from, fix include file root tags
# Run with: sudo ./scripts/system/fix-clickhouse-final-v2.sh

CFG="/etc/clickhouse-server/config.xml"
BACKUP="/etc/clickhouse-server/config.xml.bak.$(date +%Y%m%d_%H%M%S)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Fixing ClickHouse Configuration (Final v2) ===${NC}"
echo ""

if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}Error: This script must be run as root (use sudo)${NC}"
   exit 1
fi

echo -e "${YELLOW}[1/8] Stopping clickhouse-server...${NC}"
systemctl stop clickhouse-server || true
sleep 2

echo -e "${YELLOW}[2/8] Backing up config...${NC}"
cp -a "$CFG" "$BACKUP"
echo -e "${GREEN}✓ Backed up to $BACKUP${NC}"

echo -e "${YELLOW}[3/8] Fixing include files to use <yandex> root tag...${NC}"
mkdir -p /etc/clickhouse-server/config.d

# Fix clickhouse_remote_servers.xml - use <yandex> not <clickhouse>
cat > /etc/clickhouse-server/config.d/clickhouse_remote_servers.xml <<'XML'
<yandex>
  <remote_servers/>
</yandex>
XML

# Fix clickhouse_compression.xml
cat > /etc/clickhouse-server/config.d/clickhouse_compression.xml <<'XML'
<yandex>
  <compression/>
</yandex>
XML

# Fix networks.xml
cat > /etc/clickhouse-server/config.d/networks.xml <<'XML'
<yandex>
  <networks>
    <ip>::/0</ip>
  </networks>
</yandex>
XML

echo -e "${GREEN}✓ Include files fixed (using <yandex> root tag)${NC}"

echo -e "${YELLOW}[4/8] Removing include_from (ClickHouse auto-includes from config.d/)...${NC}"
# Remove include_from entirely - ClickHouse automatically includes files from config.d/
perl -i -0777 -pe 's|<include_from>.*?</include_from>\s*||gs' "$CFG"

# Double-check it's gone
if grep -q "include_from" "$CFG"; then
  echo -e "${YELLOW}⚠ include_from still found, trying sed...${NC}"
  sed -i '/include_from/d' "$CFG"
fi

if grep -q "include_from" "$CFG"; then
  echo -e "${RED}✗ Failed to remove include_from${NC}"
  echo "  Showing lines with include_from:"
  grep -n "include_from" "$CFG"
  exit 1
else
  echo -e "${GREEN}✓ include_from removed${NC}"
fi

echo -e "${YELLOW}[5/8] Making incl= references optional...${NC}"
# Make incl= references optional so they don't fail if files are missing
sed -i 's|<remote_servers incl="clickhouse_remote_servers"|<remote_servers incl="clickhouse_remote_servers" optional="true"|g' "$CFG" || true
sed -i 's|<compression incl="clickhouse_compression"|<compression incl="clickhouse_compression" optional="true"|g' "$CFG" || true
sed -i 's|<networks incl="networks"|<networks incl="networks" optional="true"|g' "$CFG" || true

echo -e "${GREEN}✓ incl= references made optional${NC}"

echo -e "${YELLOW}[6/8] Validating XML...${NC}"
if command -v xmllint >/dev/null 2>&1; then
  if xmllint --noout "$CFG" >/dev/null 2>&1; then
    echo -e "${GREEN}✓ XML is valid${NC}"
  else
    echo -e "${RED}✗ XML validation failed${NC}"
    echo "  Restoring backup..."
    cp -a "$BACKUP" "$CFG"
    exit 1
  fi
else
  echo -e "${YELLOW}⚠ xmllint not available, skipping validation${NC}"
fi

echo -e "${YELLOW}[7/8] Starting clickhouse-server...${NC}"
systemctl start clickhouse-server
sleep 5

echo ""
echo -e "${BLUE}=== Status ===${NC}"
systemctl status clickhouse-server --no-pager -l | head -20 || true

echo ""
echo -e "${BLUE}=== Testing Connection ===${NC}"
if clickhouse-client --host 127.0.0.1 --port 9000 --query "SELECT version(), 1" 2>&1; then
  echo -e "${GREEN}✅ ClickHouse is working!${NC}"
  
  echo ""
  echo -e "${BLUE}=== Checking for OHLCV Data ===${NC}"
  
  # Check databases
  echo "Databases:"
  clickhouse-client --host 127.0.0.1 --port 9000 --query "SHOW DATABASES" 2>&1 || true
  
  # Check quantbot database
  if clickhouse-client --host 127.0.0.1 --port 9000 --query "EXISTS DATABASE quantbot" 2>&1 | grep -q "1"; then
    echo ""
    echo -e "${GREEN}✓ quantbot database exists${NC}"
    
    # Check ohlcv_candles table
    if clickhouse-client --host 127.0.0.1 --port 9000 --query "EXISTS TABLE quantbot.ohlcv_candles" 2>&1 | grep -q "1"; then
      echo -e "${GREEN}✓ ohlcv_candles table exists${NC}"
      
      # Get row count
      ROW_COUNT=$(clickhouse-client --host 127.0.0.1 --port 9000 --query "SELECT COUNT(*) FROM quantbot.ohlcv_candles" 2>&1 || echo "0")
      echo "  Total rows: $ROW_COUNT"
      
      if [[ "$ROW_COUNT" != "0" ]] && [[ "$ROW_COUNT" != *"Exception"* ]] && [[ "$ROW_COUNT" =~ ^[0-9]+$ ]]; then
        echo ""
        echo -e "${GREEN}🎉 OHLCV DATA FOUND: $ROW_COUNT rows!${NC}"
        
        # Get statistics
        echo ""
        echo "Date range:"
        clickhouse-client --host 127.0.0.1 --port 9000 --query "SELECT min(timestamp) as oldest, max(timestamp) as newest FROM quantbot.ohlcv_candles" 2>&1 || true
        
        echo ""
        echo "Unique tokens:"
        clickhouse-client --host 127.0.0.1 --port 9000 --query "SELECT COUNT(DISTINCT token_address) as unique_tokens FROM quantbot.ohlcv_candles" 2>&1 || true
        
        echo ""
        echo "Data by interval:"
        clickhouse-client --host 127.0.0.1 --port 9000 --query "SELECT \`interval\`, COUNT(*) as candle_count, formatReadableSize(sum(bytes)) as size FROM system.parts WHERE database = 'quantbot' AND table = 'ohlcv_candles' AND active GROUP BY \`interval\` ORDER BY candle_count DESC" 2>&1 || true
        
        echo ""
        echo "Total table size:"
        clickhouse-client --host 127.0.0.1 --port 9000 --query "SELECT formatReadableSize(sum(bytes)) as size, sum(rows) as total_rows FROM system.parts WHERE database = 'quantbot' AND table = 'ohlcv_candles' AND active" 2>&1 || true
      else
        echo -e "${YELLOW}⚠ Table exists but is empty${NC}"
      fi
    else
      echo -e "${YELLOW}⚠ ohlcv_candles table does not exist${NC}"
    fi
  else
    echo -e "${YELLOW}⚠ quantbot database does not exist${NC}"
  fi
else
  echo -e "${RED}❌ Connection failed${NC}"
  echo ""
  echo "Recent logs:"
  journalctl -u clickhouse-server -n 30 --no-pager | tail -20
  exit 1
fi


