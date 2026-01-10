#!/bin/bash
# Fix common linting issues systematically

echo "🔧 Fixing linting issues..."

# 1. Fix @ts-ignore → @ts-expect-error
echo "1. Fixing @ts-ignore comments..."
find packages -name "*.ts" -type f -exec sed -i 's/@ts-ignore/@ts-expect-error/g' {} \;
find scripts -name "*.ts" -type f -exec sed -i 's/@ts-ignore/@ts-expect-error/g' {} \;

# 2. Fix != to !==
echo "2. Fixing != to !==..."
find packages -name "*.ts" -type f -exec sed -i 's/ != / !== /g' {} \;
find packages -name "*.ts" -type f -exec sed -i 's/(!=/(!==/g' {} \;

# 3. Fix == to ===
echo "3. Fixing == to ===..."
find packages -name "*.ts" -type f -exec sed -i 's/ == / === /g' {} \;
find packages -name "*.ts" -type f -exec sed -i 's/(==(/(===/g' {} \;

# 4. Run auto-fix
echo "4. Running ESLint auto-fix..."
npm run lint:fix 2>&1 | tail -5

# 5. Format code
echo "5. Formatting code..."
npm run format 2>&1 | tail -5

echo "✅ Done! Check remaining errors with: npm run lint"

