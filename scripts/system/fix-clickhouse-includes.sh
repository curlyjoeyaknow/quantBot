#!/usr/bin/env bash
set -euo pipefail

# Fix ClickHouse include issues
# Run with: sudo ./scripts/system/fix-clickhouse-includes.sh

CFG="/etc/clickhouse-server/config.xml"
BACKUP="/etc/clickhouse-server/config.xml.bak.$(date +%Y%m%d_%H%M%S)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Fixing ClickHouse Includes ===${NC}"
echo ""

if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}Error: This script must be run as root (use sudo)${NC}"
   exit 1
fi

echo -e "${YELLOW}[1/5] Stopping clickhouse-server...${NC}"
systemctl stop clickhouse-server || true
sleep 2

echo -e "${YELLOW}[2/5] Backing up config...${NC}"
cp -a "$CFG" "$BACKUP"
echo -e "${GREEN}✓ Backed up to $BACKUP${NC}"

echo -e "${YELLOW}[3/5] Checking include files...${NC}"
if [ -f "/etc/clickhouse-server/config.d/clickhouse_remote_servers.xml" ]; then
  echo -e "${GREEN}✓ clickhouse_remote_servers.xml exists${NC}"
else
  echo -e "${YELLOW}⚠ Creating empty clickhouse_remote_servers.xml${NC}"
  cat > /etc/clickhouse-server/config.d/clickhouse_remote_servers.xml <<'XML'
<clickhouse>
  <remote_servers/>
</clickhouse>
XML
fi

if [ -f "/etc/clickhouse-server/config.d/clickhouse_compression.xml" ]; then
  echo -e "${GREEN}✓ clickhouse_compression.xml exists${NC}"
else
  echo -e "${YELLOW}⚠ Creating empty clickhouse_compression.xml${NC}"
  cat > /etc/clickhouse-server/config.d/clickhouse_compression.xml <<'XML'
<clickhouse>
  <compression/>
</clickhouse>
XML
fi

if [ -f "/etc/clickhouse-server/config.d/networks.xml" ]; then
  echo -e "${GREEN}✓ networks.xml exists${NC}"
else
  echo -e "${YELLOW}⚠ Creating empty networks.xml${NC}"
  cat > /etc/clickhouse-server/config.d/networks.xml <<'XML'
<clickhouse>
  <networks>
    <ip>::/0</ip>
  </networks>
</clickhouse>
XML
fi

echo -e "${YELLOW}[4/5] Fixing include_from in config.xml...${NC}"

# Remove any existing include_from lines
sed -i '/<include_from>/d' "$CFG"

# Add include_from right after <clickhouse> tag
sed -i '/<clickhouse>/a\    <include_from>/etc/clickhouse-server/config.d/</include_from>' "$CFG"

# Verify include_from was added
if grep -q "include_from.*config.d" "$CFG"; then
  echo -e "${GREEN}✓ include_from added${NC}"
else
  echo -e "${RED}✗ Failed to add include_from${NC}"
  exit 1
fi

# Comment out any problematic incl= references that might still fail
# But first, let's make sure the files exist
echo -e "${YELLOW}[5/5] Validating configuration...${NC}"

if command -v xmllint >/dev/null 2>&1; then
  if xmllint --noout "$CFG" >/dev/null 2>&1; then
    echo -e "${GREEN}✓ XML is valid${NC}"
  else
    echo -e "${RED}✗ XML validation failed${NC}"
    echo "Restoring backup..."
    cp -a "$BACKUP" "$CFG"
    exit 1
  fi
fi

echo ""
echo -e "${YELLOW}Starting clickhouse-server...${NC}"
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


