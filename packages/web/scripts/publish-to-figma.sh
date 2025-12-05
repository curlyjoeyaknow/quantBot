#!/bin/bash

# Publish all Shopify components to Figma Code Connect
# This script publishes all component code to Figma Dev Mode

set -e

echo "🎨 Publishing Shopify Components to Figma..."
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Must run from web/ directory"
    exit 1
fi

# Check if authenticated
echo "📝 Checking Figma authentication..."
if ! npx figma connect whoami &>/dev/null; then
    echo "⚠️  Not authenticated. Running auth flow..."
    npx figma connect auth
else
    echo "✅ Already authenticated"
fi

echo ""
echo "📤 Publishing components..."
echo ""

# Publish with dry-run first to show what will be published
echo "Preview (dry-run):"
npx figma connect publish --dry-run

echo ""
read -p "Continue with actual publish? (y/N) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    npx figma connect publish
    echo ""
    echo "✅ Published successfully!"
    echo ""
    echo "📖 Next steps:"
    echo "1. Open: https://www.figma.com/design/dfD3nN79LuyG7Fjs6BnDxZ/Shopify"
    echo "2. Enable Dev Mode (top right)"
    echo "3. Click on duplicated frames to see your code!"
else
    echo "❌ Publish cancelled"
fi

