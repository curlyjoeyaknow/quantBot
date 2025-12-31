#!/usr/bin/env bash
set -euo pipefail

# Fix ClickHouse - remove include_from, use direct file includes
# Run with: sudo ./scripts/system/fix-clickhouse-final.sh

CFG="/etc/clickhouse-server/config.xml"
BACKUP="/etc/clickhouse-server/config.xml.bak.$(date +%Y%m%d_%H%M%S)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Fixing ClickHouse Configuration (Final) ===${NC}"
echo ""

if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}Error: This script must be run as root (use sudo)${NC}"
   exit 1
fi

echo -e "${YELLOW}[1/7] Stopping clickhouse-server...${NC}"
systemctl stop clickhouse-server || true
sleep 2

echo -e "${YELLOW}[2/7] Backing up config...${NC}"
cp -a "$CFG" "$BACKUP"
echo -e "${GREEN}✓ Backed up to $BACKUP${NC}"

echo -e "${YELLOW}[3/7] Ensuring include files exist and are valid...${NC}"
mkdir -p /etc/clickhouse-server/config.d

# Create/verify clickhouse_remote_servers.xml
cat > /etc/clickhouse-server/config.d/clickhouse_remote_servers.xml <<'XML'
<yandex>
  <remote_servers/>
</yandex>
XML

# Create/verify clickhouse_compression.xml
cat > /etc/clickhouse-server/config.d/clickhouse_compression.xml <<'XML'
<yandex>
  <compression/>
</yandex>
XML

# Create/verify networks.xml
cat > /etc/clickhouse-server/config.d/networks.xml <<'XML'
<yandex>
  <networks>
    <ip>::/0</ip>
  </networks>
</yandex>
XML

echo -e "${GREEN}✓ Include files created${NC}"

echo -e "${YELLOW}[4/7] Removing problematic include_from...${NC}"
# Remove include_from entirely - ClickHouse will auto-include files from config.d/
sed -i '/<include_from>/d' "$CFG"
sed -i '/<\/include_from>/d' "$CFG"
sed -i '/include_from/d' "$CFG"

# Verify it's removed
if grep -q "include_from" "$CFG"; then
  echo -e "${YELLOW}⚠ include_from still found, trying harder...${NC}"
  # Use perl for multiline removal
  perl -i -0777 -pe 's|<include_from>.*?</include_from>\s*||gs' "$CFG"
fi

if grep -q "include_from" "$CFG"; then
  echo -e "${RED}✗ Failed to remove include_from${NC}"
  exit 1
else
  echo -e "${GREEN}✓ include_from removed${NC}"
fi

echo -e "${YELLOW}[5/7] Commenting out problematic incl= references...${NC}"
# Comment out remote_servers with incl= if it causes issues
# But first, let's try to make them optional
sed -i 's|<remote_servers incl="clickhouse_remote_servers"|<remote_servers incl="clickhouse_remote_servers" optional="true"|g' "$CFG" || true

# If that doesn't work, comment them out
if ! grep -q 'optional="true"' "$CFG" 2>/dev/null; then
  echo "  Commenting out remote_servers incl reference..."
  sed -i 's|<remote_servers incl="clickhouse_remote_servers"|<!-- <remote_servers incl="clickhouse_remote_servers"|g' "$CFG"
  sed -i 's|</remote_servers>|</remote_servers> -->|g' "$CFG"
fi

echo -e "${YELLOW}[6/7] Validating configuration...${NC}"

if command -v xmllint >/dev/null 2>&1; then
  if xmllint --noout "$CFG" >/dev/null 2>&1; then
    echo -e "${GREEN}✓ XML is valid${NC}"
  else
    echo -e "${RED}✗ XML validation failed${NC}"
    echo "  Restoring backup and trying alternative approach..."
    cp -a "$BACKUP" "$CFG"
    
    # Alternative: just comment out all incl= references
    sed -i 's|incl="clickhouse_remote_servers"|incl="clickhouse_remote_servers" optional="true"|g' "$CFG" || true
    sed -i 's|incl="clickhouse_compression"|incl="clickhouse_compression" optional="true"|g' "$CFG" || true
    sed -i 's|incl="networks"|incl="networks" optional="true"|g' "$CFG" || true
    
    # Remove include_from
    perl -i -0777 -pe 's|<include_from>.*?</include_from>\s*||gs' "$CFG"
    
    if xmllint --noout "$CFG" >/dev/null 2>&1; then
      echo -e "${GREEN}✓ XML is valid after alternative fix${NC}"
    else
      echo -e "${RED}✗ Still invalid, restoring backup${NC}"
      cp -a "$BACKUP" "$CFG"
      exit 1
    fi
  fi
else
  echo -e "${YELLOW}⚠ xmllint not available, skipping validation${NC}"
fi

echo -e "${YELLOW}[7/7] Starting clickhouse-server...${NC}"
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
  echo ""
  echo "Config file location: $CFG"
  echo "Backup location: $BACKUP"
  exit 1
fi


