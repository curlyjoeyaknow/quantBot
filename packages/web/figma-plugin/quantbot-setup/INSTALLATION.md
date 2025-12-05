# Installation Guide - QuantBot Figma Plugin

## Quick Start (5 minutes)

### Step 1: Build the Plugin

```bash
cd packages/web/figma-plugin/quantbot-setup
npm install
npm run build
```

This will:
- Install dependencies
- Compile TypeScript to JavaScript
- Create `code.js` file

### Step 2: Load Plugin in Figma

1. **Open Figma Desktop** (plugin won't work in browser)
2. Go to **Plugins** → **Development** → **Import plugin from manifest...**
3. Navigate to: `packages/web/figma-plugin/quantbot-setup/`
4. Select `manifest.json`
5. The plugin will appear in your plugins list

### Step 3: Run the Plugin

1. Open a Figma file (new or existing)
2. Go to **Plugins** → **Development** → **QuantBot Design System Setup**
3. Click **"🚀 Setup Design System"**
4. Wait for completion notifications
5. Navigate through the created pages!

## What the Plugin Creates

### ✅ Pages (7 total)
- 🎨 Design System
- 📦 Components
- 📊 Dashboard
- ⚙️ Strategy Configuration
- 📈 Simulation Results
- 🔴 Live Trading
- 💼 Portfolio

### ✅ Design Tokens

**Color Styles:**
- Background: Primary, Secondary, Tertiary, Elevated
- Text: Primary, Secondary, Tertiary, Muted
- Accent: Success, Danger, Warning, Info (with light variants)
- Interactive: Primary, PrimaryHover, Secondary, Border, BorderHover

**Text Styles:**
- DISPLAY (48px, Bold)
- H1 (36px, Bold)
- H2 (30px, Bold)
- H3 (24px, Bold)
- H4 (20px, Medium)
- BODY (16px, Regular)
- BODYSMALL (14px, Regular)
- CAPTION (12px, Regular)

### ✅ Components

- **Button/Primary** - Ready-to-use button component
- **Card/Metric** - Metric card component
- **Input/Text** - Text input component

### ✅ Layouts

- Dashboard frame structure (1920 × 1080)
- Design system page with color swatches
- Component library page

## Troubleshooting

### "Plugin not found"
- Make sure you've built the plugin (`npm run build`)
- Check that `code.js` exists in the plugin directory
- Try restarting Figma

### "Font loading error"
- The plugin tries to load "Inter" font
- If Inter is not installed, it will use system fonts
- Install Inter font for best results: https://rsms.me/inter/

### "Styles already exist"
- If you run the plugin multiple times, it will skip existing styles
- This is normal behavior - no duplicates will be created

### "Permission denied"
- Make sure you have edit access to the Figma file
- Some team permissions might restrict style creation

## Development Mode

To make changes to the plugin:

1. Edit `code.ts`
2. Run `npm run build` (or `npm run watch` for auto-rebuild)
3. Reload plugin in Figma: **Plugins** → **Development** → **QuantBot Design System Setup** → Right-click → **Reload**

## File Structure

```
quantbot-setup/
├── manifest.json      # Plugin configuration
├── code.ts           # Source code (TypeScript)
├── code.js           # Compiled code (JavaScript) - generated
├── ui.html           # Plugin UI
├── package.json      # Dependencies
├── tsconfig.json     # TypeScript config
├── README.md         # Documentation
└── INSTALLATION.md   # This file
```

## Next Steps After Installation

1. ✅ Review created pages
2. ✅ Check design tokens in right sidebar (Styles section)
3. ✅ Expand component library using `FIGMA_COMPONENT_SPECS.md`
4. ✅ Build page layouts using React components as reference
5. ✅ Add interactions and prototypes

## Resources

- **Plugin README:** `README.md`
- **Design System:** `../../QUANTBOT_DESIGN_SYSTEM.md`
- **Component Specs:** `../../FIGMA_COMPONENT_SPECS.md`
- **Quick Setup:** `../../QUICK_FIGMA_SETUP.md`

## Support

If you encounter issues:
1. Check Figma console: **Plugins** → **Development** → **Open Console**
2. Review error messages in the plugin UI
3. Verify all files are in the correct location
4. Try rebuilding the plugin

---

**Ready to use!** 🚀

