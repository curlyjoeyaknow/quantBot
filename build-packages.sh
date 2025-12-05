#!/bin/bash
# Build QuantBot packages in dependency order

set -e  # Exit on error

echo "================================================"
echo " Building QuantBot Packages"
echo "================================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

build_package() {
  local package=$1
  echo -e "${YELLOW}Building @quantbot/$package...${NC}"
  npm run build --workspace=packages/$package
  echo -e "${GREEN}✓ @quantbot/$package built successfully${NC}"
  echo ""
}

# Build in dependency order
build_package "utils"
build_package "storage"
build_package "simulation"
build_package "services"
build_package "monitoring"
build_package "bot"

echo "================================================"
echo -e "${GREEN}✅ All packages built successfully!${NC}"
echo "================================================"
echo ""
echo "Next steps:"
echo "  - Run tests: npm run test:packages"
echo "  - Start bot: npm start"
echo "  - Build web: cd packages/web && npm run build"

