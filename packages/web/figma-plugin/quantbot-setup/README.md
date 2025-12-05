# QuantBot Design System Setup Plugin

A Figma plugin that automatically sets up the complete QuantBot Design System, including pages, design tokens, components, and layouts.

## Features

- ✅ **Automated Page Creation** - Creates all 7 pages with proper naming
- ✅ **Design Tokens** - Sets up color styles, text styles, and spacing
- ✅ **Component Library** - Creates base components (Button, Card, Input)
- ✅ **Dashboard Layout** - Sets up the main dashboard frame structure
- ✅ **Design System Documentation** - Creates design system page with color swatches

## Installation

### Method 1: Development (Recommended)

1. **Build the plugin:**
   ```bash
   cd packages/web/figma-plugin/quantbot-setup
   npm install
   npm run build
   ```

2. **Load in Figma:**
   - Open Figma Desktop
   - Go to **Plugins** → **Development** → **Import plugin from manifest...**
   - Select `manifest.json` from this directory
   - The plugin will appear in **Plugins** → **Development** → **QuantBot Design System Setup**

### Method 2: Install as Local Plugin

1. Copy the entire `quantbot-setup` folder to:
   - **Mac:** `~/Library/Application Support/Figma/Plugins/`
   - **Windows:** `%APPDATA%\Figma\Plugins\`

2. Restart Figma
3. Find it in **Plugins** → **QuantBot Design System Setup**

## Usage

1. **Open Figma** and create a new file (or use existing)
2. Go to **Plugins** → **Development** → **QuantBot Design System Setup**
3. Click **"🚀 Setup Design System"**
4. Wait for the setup to complete (you'll see progress notifications)
5. Navigate through the created pages to see the design system

## What Gets Created

### Pages
- 🎨 **Design System** - Color swatches and typography samples
- 📦 **Components** - Base component library
- 📊 **Dashboard** - Main dashboard layout
- ⚙️ **Strategy Configuration** - Empty page ready for design
- 📈 **Simulation Results** - Empty page ready for design
- 🔴 **Live Trading** - Empty page ready for design
- 💼 **Portfolio** - Empty page ready for design

### Design Tokens

**Color Styles:**
- `Background/Primary`, `Background/Secondary`, etc.
- `Text/Primary`, `Text/Secondary`, etc.
- `Accent/Success`, `Accent/Danger`, etc.
- `Interactive/Primary`, `Interactive/Border`, etc.

**Text Styles:**
- `DISPLAY` (48px, Bold)
- `H1` (36px, Bold)
- `H2` (30px, Bold)
- `H3` (24px, Bold)
- `H4` (20px, Medium)
- `BODY` (16px, Regular)
- `BODYSMALL` (14px, Regular)
- `CAPTION` (12px, Regular)

### Components

- **Button/Primary** - Primary button component
- **Card/Metric** - Metric card component
- **Input/Text** - Text input component

## Development

### Building

```bash
npm run build
```

### Watching for Changes

```bash
npm run watch
```

Then reload the plugin in Figma after making changes.

### Project Structure

```
quantbot-setup/
├── manifest.json      # Plugin configuration
├── code.ts           # Main plugin code (TypeScript)
├── code.js           # Compiled JavaScript (generated)
├── ui.html           # Plugin UI
├── package.json      # Dependencies
├── tsconfig.json     # TypeScript config
└── README.md         # This file
```

## Customization

You can modify the design tokens in `code.ts` to match your needs:

```typescript
const designTokens = {
  colors: { ... },
  spacing: { ... },
  typography: { ... }
};
```

## Troubleshooting

### Plugin doesn't appear
- Make sure you've built the plugin (`npm run build`)
- Check that `manifest.json` is in the correct location
- Restart Figma

### Font loading errors
- The plugin tries to load "Inter" font
- If Inter is not available, it will fall back to system fonts
- Install Inter font in your system for best results

### Styles not created
- Check Figma console for errors (Plugins → Development → Open Console)
- Make sure you have permission to create styles
- Some styles might already exist - the plugin will skip duplicates

## Next Steps

After running the plugin:

1. ✅ Review the created pages
2. ✅ Check design tokens in the right sidebar
3. ✅ Expand the component library
4. ✅ Build out page layouts using the component specs
5. ✅ Reference `FIGMA_COMPONENT_SPECS.md` for detailed specs

## Resources

- **Design System:** `QUANTBOT_DESIGN_SYSTEM.md`
- **Component Specs:** `FIGMA_COMPONENT_SPECS.md`
- **Setup Guide:** `QUICK_FIGMA_SETUP.md`
- **Design Tokens:** `figma-design-tokens.json`

## License

MIT

