#!/bin/bash
# Run this AFTER converting the frame to component in Figma

cd /home/memez/quantBot/web
export FIGMA_ACCESS_TOKEN="figd_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"

echo "🚀 Publishing to Figma Code Connect..."
npx figma connect publish

echo ""
echo "✅ Done! Check Figma Dev Mode to see your code."

