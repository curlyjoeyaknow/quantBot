#!/bin/bash

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}╔════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║     Testing Analytics API Endpoints           ║${NC}"
echo -e "${YELLOW}╚════════════════════════════════════════════════╝${NC}"
echo ""

BASE_URL="http://localhost:3000"

test_api() {
    local name=$1
    local endpoint=$2
    
    echo -n "Testing $name... "
    response=$(curl -s "$BASE_URL$endpoint")
    
    if echo "$response" | jq . > /dev/null 2>&1; then
        if echo "$response" | jq -e '.error' > /dev/null 2>&1; then
            echo -e "❌ ERROR"
            echo "$response" | jq '.error'
            return 1
        else
            echo -e "${GREEN}✅ OK${NC}"
            return 0
        fi
    else
        echo -e "❌ INVALID JSON"
        return 1
    fi
}

# Test all analytics endpoints
test_api "Alerts Time Series" "/api/analytics/alerts-timeseries?days=30"
test_api "Top Callers" "/api/analytics/top-callers?limit=10"
test_api "Token Distribution" "/api/analytics/token-distribution"
test_api "Hourly Activity" "/api/analytics/hourly-activity"
test_api "Top Tokens" "/api/analytics/top-tokens?limit=10"
test_api "Price Distribution" "/api/analytics/price-distribution"

echo ""
echo -e "${YELLOW}Sample Data:${NC}"
echo ""

echo -e "${GREEN}📈 Alerts Time Series (last 5 days):${NC}"
curl -s "$BASE_URL/api/analytics/alerts-timeseries?days=30" | jq '.data[-5:]'

echo ""
echo -e "${GREEN}👥 Top 3 Callers:${NC}"
curl -s "$BASE_URL/api/analytics/top-callers?limit=3" | jq '.data[:3]'

echo ""
echo -e "${GREEN}🔗 Token Distribution:${NC}"
curl -s "$BASE_URL/api/analytics/token-distribution" | jq '.data'

echo ""
echo -e "${GREEN}✅ All analytics tests complete!${NC}"
