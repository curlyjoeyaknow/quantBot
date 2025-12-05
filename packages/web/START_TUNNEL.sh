#!/bin/bash
# Quick script to start Next.js dev server and tunnel

echo "🚀 Starting QuantBot Mini App Development..."
echo ""

# Check if port 3000 is in use
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo "⚠️  Port 3000 is already in use. Please stop the existing server first."
    exit 1
fi

# Start Next.js in background
echo "📦 Starting Next.js dev server on port 3000..."
cd "$(dirname "$0")"
npm run dev > /dev/null 2>&1 &
NEXT_PID=$!

# Wait for server to start
echo "⏳ Waiting for server to start..."
sleep 5

# Check if server started successfully
if ! lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo "❌ Failed to start Next.js server"
    kill $NEXT_PID 2>/dev/null
    exit 1
fi

echo "✅ Next.js server started!"
echo ""
echo "🌐 Starting HTTPS tunnel..."
echo "   (This will give you an HTTPS URL to use in Telegram)"
echo ""

# Start tunnel
npx -y localtunnel --port 3000

# Cleanup on exit
trap "kill $NEXT_PID 2>/dev/null" EXIT

