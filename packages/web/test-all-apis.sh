#!/bin/bash

# Color output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

BASE_URL="http://localhost:3000"

echo -e "${YELLOW}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║     Testing All Web Dashboard API Endpoints             ║${NC}"
echo -e "${YELLOW}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

test_api() {
    local name=$1
    local endpoint=$2
    local expect_data=$3
    
    echo -n "Testing $name... "
    response=$(curl -s "$BASE_URL$endpoint")
    
    if echo "$response" | jq . > /dev/null 2>&1; then
        if [ "$expect_data" = "true" ]; then
            if echo "$response" | jq -e '.error' > /dev/null 2>&1; then
                echo -e "${RED}❌ ERROR${NC}"
                echo "$response" | jq '.error'
                return 1
            else
                echo -e "${GREEN}✅ OK${NC}"
                return 0
            fi
        else
            echo -e "${GREEN}✅ OK${NC}"
            return 0
        fi
    else
        echo -e "${RED}❌ INVALID JSON${NC}"
        echo "$response"
        return 1
    fi
}

# Core APIs
echo -e "\n${YELLOW}📊 Core APIs:${NC}"
test_api "Health Check" "/api/health" true
test_api "Dashboard Metrics" "/api/dashboard" true

# Alerts & Callers
echo -e "\n${YELLOW}🔔 Alerts & Callers:${NC}"
test_api "Recent Alerts" "/api/recent-alerts?limit=5" true
test_api "Callers List" "/api/callers" true
test_api "Caller Stats" "/api/callers/stats" true

# Simulations
echo -e "\n${YELLOW}🎮 Simulations:${NC}"
test_api "Simulations List" "/api/simulations" true
test_api "Simulations (paginated)" "/api/simulations?limit=10&offset=0" true

# Additional Endpoints
echo -e "\n${YELLOW}🔧 Other Endpoints:${NC}"
test_api "Metrics" "/api/metrics" false

echo ""
echo -e "${YELLOW}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║                   Detailed Test Results                  ║${NC}"
echo -e "${YELLOW}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Health Check Details
echo -e "${GREEN}🏥 Health Check Details:${NC}"
curl -s "$BASE_URL/api/health" | jq '.'

echo ""

# Dashboard Metrics Details
echo -e "${GREEN}📊 Dashboard Metrics:${NC}"
curl -s "$BASE_URL/api/dashboard" | jq '.'

echo ""

# Recent Alerts Sample
echo -e "${GREEN}🔔 Recent Alerts (3):${NC}"
curl -s "$BASE_URL/api/recent-alerts?limit=3" | jq '.alerts[:3]'

echo ""

# Callers Sample
echo -e "${GREEN}👥 Callers Sample (first 10):${NC}"
curl -s "$BASE_URL/api/callers" | jq '.data[:10]'

echo ""

# Caller Stats Sample
echo -e "${GREEN}📈 Caller Stats (top 3):${NC}"
curl -s "$BASE_URL/api/callers/stats" | jq '.data[:3]'

echo ""
echo -e "${GREEN}✅ All tests complete!${NC}"

