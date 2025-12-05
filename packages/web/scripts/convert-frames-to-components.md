# Quick Manual Guide: Convert Frames to Components in Figma

Since browser automation can't reliably convert frames to components, here's the fastest way to do it manually:

## ⚡ Quick Method (30 seconds per frame)

1. **Open Figma**: https://www.figma.com/design/dfD3nN79LuyG7Fjs6BnDxZ/Shopify

2. **For each frame, do this**:
   - Click on the frame in the layers panel (left sidebar) OR click directly on the canvas
   - Press `Ctrl+Alt+K` (Windows/Linux) or `Cmd+Option+K` (Mac)
   - Done! The frame is now a component

## 📋 Frames to Convert (7 total):

1. **SIGN IN** - Navigate to: https://www.figma.com/design/dfD3nN79LuyG7Fjs6BnDxZ/Shopify?node-id=144-2360
   - Click frame → `Ctrl+Alt+K`

2. **SETUP OVERVIEW** - Navigate to: https://www.figma.com/design/dfD3nN79LuyG7Fjs6BnDxZ/Shopify?node-id=218-739
   - Click frame → `Ctrl+Alt+K`

3. **ADD PRODUCT** - Navigate to: https://www.figma.com/design/dfD3nN79LuyG7Fjs6BnDxZ/Shopify?node-id=218-762
   - Click frame → `Ctrl+Alt+K`

4. **SHIPPING AND PRICING** - Navigate to: https://www.figma.com/design/dfD3nN79LuyG7Fjs6BnDxZ/Shopify?node-id=304-543
   - Click frame → `Ctrl+Alt+K`

5. **REGISTER** (if exists) - Find in layers panel
   - Click frame → `Ctrl+Alt+K`

6. **FORGOT PASSWORD** (if exists) - Find in layers panel
   - Click frame → `Ctrl+Alt+K`

7. **REVIEW** (if exists) - Find in layers panel
   - Click frame → `Ctrl+Alt+K`

## ✅ After Converting All Frames:

Run this to publish:
```bash
cd /home/memez/quantBot/web
export FIGMA_ACCESS_TOKEN="figd_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
npx figma connect publish
```

## 🎯 Total Time: ~3-5 minutes for all 7 frames

