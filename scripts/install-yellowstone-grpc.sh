#!/bin/bash
# Install Yellowstone gRPC client for Shyft

echo "Installing Yellowstone gRPC client..."
npm install @triton-one/yellowstone-grpc

echo "✅ Installation complete!"
echo ""
echo "Next steps:"
echo "1. Get your Shyft x-token from https://shyft.to"
echo "2. Add SHYFT_X_TOKEN to your .env file"
echo "3. Run: ts-node src/monitoring/start-tenkan-kijun-alerts.ts"
