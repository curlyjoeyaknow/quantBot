# Quick Setup - Telegram Mini App

## Step 1: Start the Development Server with Tunnel

**Option A: Use the helper script (easiest)**
```bash
cd web
./START_TUNNEL.sh
```

**Option B: Manual (two terminals)**

Terminal 1:
```bash
cd web
npm run dev
```

Terminal 2:
```bash
cd web
npm run dev:tunnel
```

## Step 2: Copy the HTTPS URL

The tunnel will output something like:
```
your url is: https://random-name.loca.lt
```

Copy that URL!

## Step 3: Set Environment Variable

Create or update `web/.env`:
```bash
MINI_APP_URL=https://random-name.loca.lt/miniapp
```

**Note:** The URL changes each time you restart the tunnel. Update `.env` and BotFather each time.

## Step 4: Update BotFather

1. Open Telegram → @BotFather
2. Send `/mybots`
3. Select your bot
4. Choose "Bot Settings" → "Menu Button"
5. Set URL to: `https://random-name.loca.lt/miniapp` (use your actual tunnel URL)

## Step 5: Test!

1. Send `/backtest` to your bot
2. Click "📱 Open Mini App" button
3. The mini app should open in Telegram!

## Troubleshooting

**Tunnel URL keeps changing?**
- That's normal with free tunnels
- Just update `.env` and BotFather each time
- Or use a paid ngrok plan for a static URL

**Can't connect?**
- Make sure Next.js is running on port 3000
- Check that the tunnel URL is correct
- Try restarting both the dev server and tunnel

**Want to test UI without Telegram?**
```bash
cd web
npm run dev
# Open http://localhost:3000/miniapp in browser
```

