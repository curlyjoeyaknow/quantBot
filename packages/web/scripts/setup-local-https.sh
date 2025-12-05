#!/bin/bash
# Quick setup for local HTTPS development
# This uses mkcert to create local SSL certificates

echo "Setting up local HTTPS for Telegram Mini App..."

# Check if mkcert is installed
if ! command -v mkcert &> /dev/null; then
    echo "mkcert not found. Installing..."
    
    # Detect OS
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        brew install mkcert
        brew install nss  # For Firefox
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        sudo apt-get update
        sudo apt-get install -y libnss3-tools
        curl -JLO "https://dl.filippo.io/mkcert/latest?for=linux/amd64"
        chmod +x mkcert-v*-linux-amd64
        sudo mv mkcert-v*-linux-amd64 /usr/local/bin/mkcert
    fi
    
    # Install local CA
    mkcert -install
fi

# Create certs directory
mkdir -p .certs

# Generate certificate for localhost
cd .certs
mkcert localhost 127.0.0.1 ::1
cd ..

echo "✅ Certificates created in .certs/"
echo ""
echo "To use with Next.js, update package.json scripts:"
echo "  \"dev:https\": \"next dev --experimental-https --experimental-https-key .certs/localhost+2-key.pem --experimental-https-cert .certs/localhost+2.pem\""
echo ""
echo "Or use a simple tunnel instead (easier):"
echo "  npx localtunnel --port 3000"

