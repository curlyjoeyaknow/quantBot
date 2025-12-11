# Figma Plugins Guide

Two plugins to automatically create Figma designs from your React figma-replica components.

## Plugins Overview

### 1. Mobile Replicas Plugin
**Location:** `figma-plugin/quantbot-setup/`
**Creates:** Mobile versions (440×956)
**Output:** Horizontal layout on "📱 Figma Replicas" page

### 2. Desktop Replicas Plugin  
**Location:** `figma-plugin/quantbot-desktop-replicas/`
**Creates:** Desktop versions (1920×1080)
**Output:** Vertical stack on "🖥️ Desktop Replicas" page

---

## Quick Setup (Both Plugins)

### Step 1: Build Plugins

```bash
# Mobile plugin
cd packages/web/figma-plugin/quantbot-setup
npm install
npm run build

# Desktop plugin
cd packages/web/figma-plugin/quantbot-desktop-replicas
npm install
npm run build
```

### Step 2: Load in Figma

1. Open **Figma Desktop** (required)
2. Go to **Plugins** → **Development** → **Import plugin from manifest...**
3. Import both:
   - Select `quantbot-setup/manifest.json`
   - Then `quantbot-desktop-replicas/manifest.json`
4. Both appear in **Plugins** → **Development**

### Step 3: Use Them

**Create Mobile Replicas:**
- **Plugins** → **Development** → **QuantBot Figma Replicas**
- Click "🎨 Create Figma Replicas"

**Create Desktop Replicas:**
- **Plugins** → **Development** → **QuantBot Desktop Replicas**
- Click "🖥️ Create Desktop Replicas"

---

## What Gets Created

### Mobile Plugin (440×956 each)

Components laid out horizontally:
1. Sign In (dark teal background)
2. Register
3. Forgot Password
4. Setup Overview (Step 1/4)
5. Add Product (Step 2/4)
6. Shipping & Pricing (Step 3/4)
7. Review Summary (Step 4/4)

### Desktop Plugin (1920×1080 each)

Components stacked vertically:
1. **Desktop Sign In** - Split panel (form left, branding right)
2. **Desktop Register** - Enhanced form with branding
3. **Desktop Forgot Password** - Cleaner layout
4. **Desktop Setup Overview** - Centered content with header
5. **Desktop Add Product** - Two columns (details + image)
6. **Desktop Shipping & Pricing** - Enhanced form
7. **Desktop Review Summary** - Three-column summary

---

## Manifest Files

Both manifest files include `"dev"` in editorType:

```json
{
  "name": "Plugin Name",
  "id": "plugin-id",
  "api": "1.0.0",
  "main": "code.js",
  "ui": "ui.html",
  "editorType": ["figma", "dev"]
}
```

---

## Troubleshooting

### "Font not available" warnings
- Plugins try to load Inter font first
- Falls back to system fonts if not available
- Install Inter for best results: https://rsms.me/inter/

### Plugin not showing
- Make sure you built the plugin (`npm run build`)
- Check `code.js` exists
- Restart Figma Desktop

### Elements not centered
- Text centering is approximate
- Adjust manually in Figma after generation
- Use Auto Layout for better positioning

### "Manifest error"
- Make sure `editorType` includes both `"figma"` and `"dev"`
- Check JSON is valid (no trailing commas)
- Verify all required fields are present

---

## Development

To modify plugins:

```bash
# Edit code.ts files
# Then rebuild:
cd figma-plugin/quantbot-setup
npm run watch  # Auto-rebuild on changes

# Or build once:
npm run build

# Reload in Figma:
# Right-click plugin → Reload
```

---

## File Structure

```
figma-plugin/
├── quantbot-setup/              # Mobile replicas
│   ├── manifest.json
│   ├── code.ts
│   ├── code.js (generated)
│   ├── package.json
│   └── README.md
│
└── quantbot-desktop-replicas/   # Desktop replicas
    ├── manifest.json
    ├── code.ts
    ├── code.js (generated)
    ├── package.json
    └── README.md
```

---

## Next Steps

1. ✅ Build both plugins
2. ✅ Load into Figma
3. ✅ Run mobile plugin → creates mobile versions
4. ✅ Run desktop plugin → creates desktop versions
5. ✅ Customize in Figma (adjust spacing, add details)
6. ✅ Export or use for design reference

---

**Both plugins are ready to use!** 🚀

