# Figma Access Token Setup

## Create Token (Simple Method)

1. **Go to:** https://www.figma.com/settings
2. Scroll to **"Personal access tokens"**
3. Click **"Generate new token"**
4. **Name it:** "Code Connect"
5. **Select scope:**
   - ✅ **File content** (this is all you need!)
6. Click **"Generate token"**
7. **Copy the token** (you only see it once!)

## Update and Publish

Run this command and paste your token when prompted:

```bash
cd /home/memez/quantBot/web
export FIGMA_ACCESS_TOKEN="YOUR_TOKEN_HERE"
npx figma connect publish --skip-validation
```

Or use the interactive script:
```bash
/home/memez/quantBot/web/UPDATE_TOKEN_AND_PUBLISH.sh
```

## Current Token Issue

Your current token (`figd_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`) is giving a 403 error.

Possible reasons:
- Token expired
- Wrong permissions
- Need to regenerate with File content scope

## After Publishing Successfully

Check your code in Figma Dev Mode:
https://www.figma.com/design/kBMg5IBOJ6RYT1DX0yr7kL/Testt?node-id=7-583&m=dev

