# Quick Start - Local Development

## Easiest Option: Use a Tunnel (30 seconds)

```bash
# Terminal 1: Start Next.js
cd web
npm run dev

# Terminal 2: Start tunnel (gives you HTTPS URL)
npm run dev:tunnel
# Copy the HTTPS URL it gives you (e.g., https://random-name.loca.lt)

# Set in .env:
MINI_APP_URL=https://random-name.loca.lt/miniapp

# Update BotFather menu button with same URL
```

That's it! The tunnel provides HTTPS automatically.

## Alternative: Local HTTPS (if you want localhost)

```bash
# 1. Install mkcert (one time)
# macOS:
brew install mkcert

# Linux:
sudo apt-get install libnss3-tools
curl -JLO "https://dl.filippo.io/mkcert/latest?for=linux/amd64"
chmod +x mkcert-v*-linux-amd64
sudo mv mkcert-v*-linux-amd64 /usr/local/bin/mkcert

# 2. Setup local CA (one time)
mkcert -install

# 3. Generate certs
mkdir -p web/.certs
cd web/.certs
mkcert localhost 127.0.0.1 ::1
cd ../..

# 4. Run with HTTPS
cd web
npm run dev:https

# 5. Use https://localhost:3000/miniapp in BotFather
```

## Testing Without Telegram (UI Only)

You can test the UI components without Telegram:

```bash
cd web
npm run dev
# Open http://localhost:3000/miniapp in browser
# (Telegram SDK won't work, but you can see the UI)
```

## For Production

Just deploy to Vercel/Netlify/Railway - they give you HTTPS automatically.

