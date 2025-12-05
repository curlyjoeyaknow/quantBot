# How to Convert Frames to Components in Figma

## Method 1: Right-Click Menu (Most Reliable) ✅

1. Open: https://www.figma.com/design/dfD3nN79LuyG7Fjs6BnDxZ/Shopify
2. In the **Layers panel** (left side), find:
   - SIGN IN
   - SETUP OVERVIEW  
   - ADD PRODUCT
   - SHIPPING AND PRICING
3. **Right-click** on the frame name
4. Select **"Create component"** from the menu
5. The frame icon will change to a purple diamond 💎 (component icon)

## Method 2: Top Menu Bar

1. Click on the frame to select it
2. Go to top menu: **Object** → **Create Component**
3. Or look for the component icon in the top toolbar

## Method 3: Keyboard Shortcuts

**Mac:**
- `Cmd` + `Option` + `K`

**Windows/Linux:**
- `Ctrl` + `Alt` + `K`

**Note:** Make sure the frame is **selected** first (you'll see a blue outline)

## Method 4: Component Button in Toolbar

1. Select the frame
2. Look for the **purple diamond icon** (⬥) in the top toolbar
3. Click it to convert to component

## Verification:

After conversion, you should see:
- Purple diamond icon (💎) next to the layer name (instead of blue frame icon)
- The layer is now called a "Component" in the properties panel

## If Still Not Working:

**Check permissions:**
- Do you have edit access to this Figma file?
- Are you signed in to the correct account?
- Try **duplicating** the file first (File → Duplicate)

**Already components?**
- Check if they're already components (purple diamond icon)
- If so, you can publish right away!

## Next Step:

Once converted, run:
```bash
cd /home/memez/quantBot/web
export FIGMA_ACCESS_TOKEN="figd_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
npx figma connect publish
```

