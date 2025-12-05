# Vercel Deployment URL

Based on the deployment output, your Mini App URL is:

## Production URL
```
https://web-756lmanki-memeworldorders-projects.vercel.app/miniapp
```

## Next Steps

1. **Set Environment Variable in Vercel:**
   - Go to https://vercel.com/memeworldorders-projects/web
   - Settings → Environment Variables
   - Add: `MINI_APP_URL` = `https://web-756lmanki-memeworldorders-projects.vercel.app/miniapp`

2. **Update BotFather:**
   - @BotFather → Your Bot → Bot Settings → Menu Button
   - Set URL to: `https://web-756lmanki-memeworldorders-projects.vercel.app/miniapp`

3. **Update Local .env (optional):**
   ```bash
   MINI_APP_URL=https://web-756lmanki-memeworldorders-projects.vercel.app/miniapp
   ```

## Custom Domain (Optional)

If you want a cleaner URL, you can add a custom domain in Vercel:
- Settings → Domains
- Add your domain (e.g., `miniapp.yourdomain.com`)
- Then use: `https://miniapp.yourdomain.com/miniapp`

## Check Deployment Status

```bash
cd web
vercel --token qtVKiPDBT1KqEtHAx1lj0ROk ls
```

## Redeploy

```bash
cd web
vercel --token qtVKiPDBT1KqEtHAx1lj0ROk --prod
```

