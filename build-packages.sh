#!/bin/bash
#
# Build QuantBot Packages
# =======================
# Builds packages in correct dependency order using TypeScript's composite project mode
#

set -e  # Exit on error

echo -e "\e[1;34m================================================\e[0m"
echo -e "\e[1;34m Building QuantBot Packages\e[0m"
echo -e "\e[1;34m================================================\e[0m"
echo ""

# Build packages in dependency order using tsc --build for composite projects
packages=("utils" "storage" "simulation" "services" "monitoring" "bot")

for pkg in "${packages[@]}"; do
  echo -e "\e[1;33mBuilding @quantbot/$pkg...\e[0m"
  if npx tsc --build packages/$pkg/tsconfig.json; then
    echo -e "\e[0;32m✓ @quantbot/$pkg built successfully\e[0m"
    echo ""
  else
    echo -e "\e[0;31m✗ @quantbot/$pkg build failed\e[0m"
    exit 1
  fi
done

echo -e "\e[0;32m================================================\e[0m"
echo -e "\e[0;32m All packages built successfully!\e[0m"
echo -e "\e[0;32m================================================\e[0m"
