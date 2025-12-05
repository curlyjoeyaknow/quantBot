#!/bin/bash
# Update token and publish to Figma

echo "Paste your new Figma access token (with File Read + Code Connect Write scopes):"
read -r NEW_TOKEN

cd /home/memez/quantBot/web

# Update .env.local
sed -i "s/^FIGMA_ACCESS_TOKEN=.*/FIGMA_ACCESS_TOKEN=$NEW_TOKEN/" .env.local

echo "✅ Token updated in .env.local"
echo ""
echo "🚀 Publishing to Figma..."

export FIGMA_ACCESS_TOKEN="$NEW_TOKEN"
npx figma connect publish --skip-validation

echo ""
echo "✅ Done! Check Figma Dev Mode:"
echo "https://www.figma.com/design/kBMg5IBOJ6RYT1DX0yr7kL/Testt?node-id=7-583&m=dev"

