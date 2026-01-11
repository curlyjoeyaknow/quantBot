#!/bin/bash
# Monitor OHLCV fetch progress with filtered, colored output

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m' # No Color

LOG_FILE="${1:-logs/combined-$(date +%Y-%m-%d).log}"

echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}${CYAN}  OHLCV Fetch Monitor${NC}"
echo -e "${GRAY}  Watching: ${LOG_FILE}${NC}"
echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Counters
declare -A stats
stats[fetched]=0
stats[stored]=0
stats[coverage]=0
stats[errors]=0

tail -f "$LOG_FILE" 2>/dev/null | while read -r line; do
  # Parse JSON fields
  msg=$(echo "$line" | jq -r '.message // empty' 2>/dev/null)
  level=$(echo "$line" | jq -r '.level // empty' 2>/dev/null)
  
  # Skip if not valid JSON or no message
  [[ -z "$msg" ]] && continue
  
  # Filter and format based on message type
  case "$msg" in
    "Fetching OHLCV for alerts from DuckDB")
      interval=$(echo "$line" | jq -r '.interval // "?"')
      concurrency=$(echo "$line" | jq -r '.concurrency // "?"')
      echo -e "${BOLD}${BLUE}▶ START${NC} interval=${CYAN}${interval}${NC} concurrency=${CYAN}${concurrency}${NC}"
      ;;
      
    "Found alerts in DuckDB")
      calls=$(echo "$line" | jq -r '.calls // 0')
      echo -e "${BLUE}  📋 Found ${BOLD}${calls}${NC}${BLUE} alerts to process${NC}"
      ;;
      
    *"Processing alert for"*)
      mint=$(echo "$line" | jq -r '.mint // "?"' | cut -c1-12)
      # Extract alert number from message
      alertNum=$(echo "$msg" | grep -oP '\[\d+/\d+\]' | head -1)
      echo -ne "${GRAY}  ⏳ ${alertNum} ${mint}...${NC}\r"
      ;;
      
    "Fetched and stored"*)
      mint=$(echo "$line" | jq -r '.mint // "?"' | cut -c1-12)
      candles=$(echo "$line" | jq -r '.candlesFetched // 0')
      fetchMs=$(echo "$line" | jq -r '.fetchDurationMs // 0')
      storeMs=$(echo "$line" | jq -r '.storeDurationMs // 0')
      ((stats[stored]++))
      echo -e "${GREEN}  ✓ ${mint}... ${BOLD}${candles}${NC}${GREEN} candles${NC} ${GRAY}(fetch:${fetchMs}ms store:${storeMs}ms)${NC}      "
      ;;
      
    "Full coverage achieved"*)
      mint=$(echo "$line" | jq -r '.mint // "?"' | cut -c1-12)
      count=$(echo "$line" | jq -r '.candleCount // 0')
      ((stats[coverage]++))
      echo -e "${GREEN}  ✅ ${mint}... coverage OK (${count} candles)${NC}      "
      ;;
      
    "Incomplete coverage"*)
      mint=$(echo "$line" | jq -r '.mint // "?"' | cut -c1-12)
      current=$(echo "$line" | jq -r '.currentCandles // 0')
      required=$(echo "$line" | jq -r '.requiredCandles // 0')
      echo -e "${YELLOW}  ⚠ ${mint}... incomplete (${current}/${required})${NC}      "
      ;;
      
    "Completed fetching OHLCV"*)
      processed=$(echo "$line" | jq -r '.alertsProcessed // 0')
      success=$(echo "$line" | jq -r '.alertsWithFullCoverage // 0')
      failed=$(echo "$line" | jq -r '.fetchesFailed // 0')
      total=$(echo "$line" | jq -r '.totalCandlesFetched // 0')
      echo ""
      echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
      echo -e "${BOLD}${GREEN}✓ COMPLETE${NC}"
      echo -e "  Alerts: ${BOLD}${processed}${NC} processed, ${GREEN}${success}${NC} full coverage, ${RED}${failed}${NC} failed"
      echo -e "  Candles: ${BOLD}${total}${NC} total fetched"
      echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
      ;;
      
    *"Error"*|*"error"*|*"Failed"*|*"EPIPE"*)
      if [[ "$level" == "error" ]]; then
        mint=$(echo "$line" | jq -r '.mint // .token // "?"' | cut -c1-12)
        error=$(echo "$line" | jq -r '.error.message // .error // "unknown"' | cut -c1-50)
        ((stats[errors]++))
        echo -e "${RED}  ✗ ${mint}... ERROR: ${error}${NC}      "
      fi
      ;;
  esac
done

