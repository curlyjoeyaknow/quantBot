# QuantBot Desktop Replicas Plugin

Creates desktop-optimized (1920px width) Figma designs from the figma-replica components.

## What It Creates

- **Desktop Sign In** - Split panel layout (form + branding)
- **Desktop Register** - Enhanced registration form
- **Desktop Forgot Password** - Password reset flow
- **Desktop Setup Overview** - Step 1/4 with centered content
- **Desktop Add Product** - Two-column layout (details + image)
- **Desktop Shipping & Pricing** - Step 3/4 enhanced
- **Desktop Review Summary** - Three-column summary view

## Installation

```bash
cd packages/web/figma-plugin/quantbot-desktop-replicas
npm install
npm run build
```

## Load in Figma

1. Open Figma Desktop
2. **Plugins** → **Development** → **Import plugin from manifest...**
3. Select `manifest.json` from this directory
4. Plugin appears in **Plugins** → **Development** → **QuantBot Desktop Replicas**

## Usage

1. Open or create a Figma file
2. Run: **Plugins** → **Development** → **QuantBot Desktop Replicas**
3. Click **"🖥️ Create Desktop Replicas"**
4. Desktop versions (1920×1080) will be created on a new page

## Features

- ✅ 1920px wide layouts
- ✅ Split panel designs (form + branding)
- ✅ Multi-column layouts
- ✅ Enhanced spacing and typography
- ✅ Desktop-optimized UI elements
- ✅ Progress indicators
- ✅ Consistent styling

## Based On

React components in `/packages/web/app/figma-replicas/`

