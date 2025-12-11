# Figma Plugins - Installation & Usage

## ✅ Both Plugins Ready!

Two Figma plugins that generate designs from your figma-replica components:

1. **Mobile Replicas** (440×956) - Original mobile designs
2. **Desktop Replicas** (1920×1080) - Desktop-optimized versions

---

## Quick Install (5 minutes)

### Step 1: Build Both Plugins

```bash
# From project root
cd packages/web/figma-plugin

# Build mobile plugin
cd quantbot-setup
npm install
npm run build
cd ..

# Build desktop plugin
cd quantbot-desktop-replicas
npm install
npm run build
cd ..
```

**Status:** ✅ Both already built and ready!

### Step 2: Load Into Figma

1. **Open Figma Desktop** (required - plugins don't work in browser)

2. **Import Mobile Plugin:**
   - **Plugins** → **Development** → **Import plugin from manifest...**
   - Navigate to: `packages/web/figma-plugin/quantbot-setup/`
   - Select `manifest.json`
   - Plugin loads as: **"QuantBot Figma Replicas"**

3. **Import Desktop Plugin:**
   - **Plugins** → **Development** → **Import plugin from manifest...**
   - Navigate to: `packages/web/figma-plugin/quantbot-desktop-replicas/`
   - Select `manifest.json`
   - Plugin loads as: **"QuantBot Desktop Replicas"**

### Step 3: Run the Plugins

**For Mobile Versions:**
1. Create or open a Figma file
2. **Plugins** → **Development** → **QuantBot Figma Replicas**
3. Click **"🎨 Create Figma Replicas"**
4. Wait for "✅ Figma replicas created successfully!" notification
5. Navigate to the "📱 Figma Replicas" page

**For Desktop Versions:**
1. In the same or different Figma file
2. **Plugins** → **Development** → **QuantBot Desktop Replicas**
3. Click **"🖥️ Create Desktop Replicas"**
4. Wait for "✅ Desktop replicas created!" notification
5. Navigate to the "🖥️ Desktop Replicas" page

---

## What Each Plugin Creates

### Mobile Plugin Output

**Page:** 📱 Figma Replicas  
**Layout:** Horizontal (side by side)  
**Size:** 440×956 per component

Components:
- Sign In (dark teal background #0a3a32)
- Register
- Forgot Password
- Setup Overview (Step 1/4)
- Add Product (Step 2/4)
- Shipping & Pricing (Step 3/4)
- Review Summary (Step 4/4)

### Desktop Plugin Output

**Page:** 🖥️ Desktop Replicas  
**Layout:** Vertical (stacked)  
**Size:** 1920×1080 per component

Components:
- Desktop Sign In (split panel: form + branding)
- Desktop Register (enhanced layout)
- Desktop Forgot Password
- Desktop Setup Overview (centered with header)
- Desktop Add Product (two columns)
- Desktop Shipping & Pricing
- Desktop Review Summary (three columns)

---

## Manifest Files

Both manifests include `"dev"` in `editorType`:

```json
{
  "editorType": ["figma", "dev"]
}
```

This allows the plugins to work in both Figma and Figma Dev Mode.

---

## Verification

Check that both plugins loaded correctly:

```bash
# Verify mobile plugin built
ls packages/web/figma-plugin/quantbot-setup/code.js

# Verify desktop plugin built
ls packages/web/figma-plugin/quantbot-desktop-replicas/code.js

# Both should exist!
```

---

## Troubleshooting

### "Plugin not found"
- Make sure you're using **Figma Desktop** (not browser)
- Verify `code.js` exists in plugin directory
- Try restarting Figma

### "Manifest error" or "does not include type 'dev'"
- ✅ **FIXED** - Both manifests now have `"editorType": ["figma", "dev"]`
- If still seeing error, delete and re-import the plugin

### Font errors
- Plugins try to load Inter font
- Falls back to system fonts if not available
- Install Inter: https://rsms.me/inter/

### Elements not positioned correctly
- Generated positions are approximate
- Use Figma's Auto Layout to adjust after creation
- Text centering can be refined manually

---

## Using the Generated Designs

1. **Review the generated frames**
2. **Adjust spacing** using Auto Layout
3. **Add interactions** (prototyping)
4. **Customize colors** if needed
5. **Export assets** for documentation
6. **Create variants** for different states

---

## File Locations

```
packages/web/figma-plugin/
├── quantbot-setup/              # Mobile replicas
│   ├── manifest.json           ← Import this first
│   ├── code.js                 ← Built and ready
│   └── README.md
│
└── quantbot-desktop-replicas/   # Desktop replicas
    ├── manifest.json           ← Import this second
    ├── code.js                 ← Built and ready
    └── README.md
```

---

## Next Steps

After generating the Figma designs:

1. ✅ Review all generated frames
2. ✅ Adjust layouts using Auto Layout
3. ✅ Add component variants (hover, active states)
4. ✅ Create prototypes for navigation flows
5. ✅ Export screens for documentation
6. ✅ Use as design reference for development

---

## Quick Reference

| Plugin | Size | Layout | Page Name |
|--------|------|--------|-----------|
| Mobile | 440×956 | Horizontal | 📱 Figma Replicas |
| Desktop | 1920×1080 | Vertical | 🖥️ Desktop Replicas |

**Both plugins are built, compiled, and ready to import!** 🎉

Just load them into Figma Desktop and run them.

