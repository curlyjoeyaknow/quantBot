# Deploy to Vercel

## Quick Deploy

```bash
cd web

# Login to Vercel (one time)
vercel login

# Deploy (will prompt for project settings)
vercel --prod

# Or use the token directly
vercel --token qtVKiPDBT1KqEtHAx1lj0ROk --prod
```

## Environment Variables

After deployment, set environment variables in Vercel dashboard:

1. Go to your project on vercel.com
2. Settings → Environment Variables
3. Add:
   - `MINI_APP_URL` = `https://your-project.vercel.app/miniapp`
   - Any other env vars your app needs (DATABASE_URL, etc.)

## Get Your Deployment URL

After deployment, Vercel will show you the URL:
```
✅ Production: https://your-project.vercel.app
```

Use this URL for the Mini App:
```
https://your-project.vercel.app/miniapp
```

## Update Bot Configuration

1. Update `web/.env` (for local reference):
   ```bash
   MINI_APP_URL=https://your-project.vercel.app/miniapp
   ```

2. Update BotFather:
   - @BotFather → Your Bot → Bot Settings → Menu Button
   - Set URL to: `https://your-project.vercel.app/miniapp`

## Continuous Deployment

Vercel automatically deploys on git push if you connect your repo, or you can deploy manually:

```bash
vercel --token qtVKiPDBT1KqEtHAx1lj0ROk --prod
```

