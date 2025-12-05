# Convert Figma Frames to Components

Code Connect requires **Components**, not Frames. Here's how to convert:

## Quick Steps

1. **Open Figma**: https://www.figma.com/design/dfD3nN79LuyG7Fjs6BnDxZ/Shopify

2. **For each frame, convert to component**:
   - Select the frame (e.g., "SIGN IN")
   - Press `Ctrl+Alt+K` (Windows/Linux) or `Cmd+Option+K` (Mac)
   - OR right-click → **"Create Component"** or **"Frame to Component"**

3. **Convert these frames**:
   - ✅ SIGN IN (node-id=144-2360)
   - ✅ REGISTER (if exists)
   - ✅ FORGOT PASSWORD (if exists)  
   - ✅ SETUP OVERVIEW (node-id=218-739)
   - ✅ ADD PRODUCT (node-id=218-762)
   - ✅ SHIPPING AND PRICING (node-id=304-543)
   - ✅ REVIEW (if exists)

4. **After converting, publish again**:
   ```bash
   cd /home/memez/quantBot/web
   export FIGMA_ACCESS_TOKEN="figd_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
   npx figma connect publish
   ```

## Alternative: Use Duplicated Components

If you want to keep originals as frames:
1. Duplicate each frame
2. Convert the **duplicate** to a component
3. Update node-ids in `.figma.tsx` files to point to the duplicated components

