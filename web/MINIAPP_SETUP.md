# Telegram Mini App Setup Guide

## Overview

The Telegram Mini App provides a modern web-based interface for running backtests and managing strategies directly within Telegram. This replaces the text-based command flow with an intuitive UI.

## Features

- **Backtest Configuration**: Visual interface for setting up simulations
- **Strategy Management**: Create, edit, and delete trading strategies
- **Results Display**: View simulation results with detailed statistics
- **Recent Calls Integration**: Quick access to recent token calls

## Setup Instructions

### 1. Configure Bot

Add the Mini App button to your bot using BotFather:

1. Open [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/mybots`
3. Select your bot
4. Choose "Bot Settings" → "Menu Button"
5. Set the menu button text (e.g., "Open QuantBot")
6. Set the URL to: `https://your-domain.com/miniapp`

### 2. Environment Variables

Add to your `.env` file:

```bash
# Mini App Configuration
MINI_APP_URL=https://your-domain.com/miniapp  # Production
# OR for local development:
# MINI_APP_URL=https://your-ngrok-url.ngrok.io/miniapp
BOT_SERVICE_URL=http://localhost:3001  # If using separate bot service
```

### 3. Update Bot Command Handler

The `/backtest` command now includes a Mini App button. The URL is configured via `MINI_APP_URL` environment variable.

### 4. URL Requirements

**Telegram Mini Apps require HTTPS** - you cannot use:
- ❌ `http://localhost:3000` (no HTTPS)
- ❌ `http://192.168.1.100:3000` (no HTTPS, no domain)

**You CAN use:**
- ✅ `https://your-domain.com/miniapp` (production domain)
- ✅ `https://your-ngrok-url.ngrok.io/miniapp` (ngrok for local dev)
- ✅ `https://your-cloudflare-tunnel-url.com/miniapp` (Cloudflare Tunnel)
- ✅ `https://your-localtunnel-url.loca.lt/miniapp` (localtunnel)

### 5. Local Development Setup

For local development, use a tunneling service:

**Option A: ngrok (Recommended)**
```bash
# Install ngrok: https://ngrok.com/download
ngrok http 3000

# Copy the HTTPS URL (e.g., https://abc123.ngrok.io)
# Set MINI_APP_URL=https://abc123.ngrok.io/miniapp
```

**Option B: Cloudflare Tunnel**
```bash
# Install cloudflared
cloudflared tunnel --url http://localhost:3000

# Copy the HTTPS URL provided
```

**Option C: localtunnel**
```bash
npm install -g localtunnel
lt --port 3000

# Copy the HTTPS URL provided
```

### 6. Deploy Web App

For production, ensure your Next.js web app is deployed and accessible via HTTPS at the URL configured in BotFather.

### 5. API Integration

The Mini App requires API endpoints to be implemented:

- `/api/miniapp/backtest` - Run backtest simulations
- `/api/miniapp/results` - Fetch user's simulation results
- `/api/miniapp/strategies` - CRUD operations for strategies

**Note**: Currently, these endpoints return placeholder responses. You need to:

1. **Option A**: Integrate with the bot service API (recommended)
   - The bot service has the full simulation engine
   - Call it via HTTP from the web app

2. **Option B**: Copy simulation engine to web app
   - Copy `src/simulation/engine.ts` and `src/simulation/candles.ts` to `web/lib/simulation/`
   - Update imports in API routes

## File Structure

```
web/
├── app/
│   ├── miniapp/
│   │   ├── page.tsx              # Main Mini App entry point
│   │   ├── backtest-config.tsx   # Backtest configuration UI
│   │   ├── simulation-results.tsx # Results display
│   │   └── strategy-manager.tsx   # Strategy management
│   └── api/
│       └── miniapp/
│           ├── backtest/
│           │   └── route.ts      # Backtest API endpoint
│           ├── results/
│           │   └── route.ts      # Results API endpoint
│           └── strategies/
│               └── route.ts      # Strategies API endpoint
└── lib/
    └── types/
        └── simulation.ts         # Simulation type definitions
```

## Usage

1. User sends `/backtest` command in Telegram
2. Bot responds with inline keyboard including "Open Mini App" button
3. User clicks button → Mini App opens in Telegram
4. User configures backtest in the web interface
5. Results are displayed and can be sent back to the bot

## Data Flow

```
Telegram Bot → Mini App (Web) → API Endpoints → Bot Service (or local engine)
```

## Testing Locally

**Telegram requires HTTPS**, but we've made it super easy:

### Option 1: Quick Tunnel (Easiest - 30 seconds)

```bash
# Terminal 1: Start Next.js
cd web
npm run dev

# Terminal 2: Start tunnel (auto HTTPS)
npm run dev:tunnel
# Copy the HTTPS URL (e.g., https://random-name.loca.lt)

# Set in .env:
MINI_APP_URL=https://random-name.loca.lt/miniapp

# Update BotFather menu button with same URL
```

### Option 2: Local HTTPS (if you want localhost)

```bash
# One-time setup (see QUICK_START.md for details)
./web/scripts/setup-local-https.sh

# Then run:
cd web
npm run dev:https

# Use https://localhost:3000/miniapp in BotFather
```

### Option 3: Test UI Without Telegram

Just test the UI components:
```bash
cd web
npm run dev
# Open http://localhost:3000/miniapp in browser
# (Telegram SDK won't work, but you can see/test the UI)
```

**Note:** For production, just deploy to Vercel/Netlify - they give you HTTPS automatically.

## Security Considerations

- Mini App receives user data via Telegram Web App SDK (`initData`)
- Validate `initData` on the server side before processing requests
- Use HTTPS for all Mini App URLs
- Implement rate limiting on API endpoints

## Next Steps

1. Implement database integration for saving/loading results
2. Add real-time progress updates during simulation
3. Implement strategy templates/presets
4. Add chart visualization for results
5. Support for multiple chains in UI

