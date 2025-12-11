# QuantBot Figma Replicas Plugin

Creates mobile-optimized Figma designs (440×956) from the figma-replica React components.

## What It Creates

- **Sign In** (440×956) - Dark teal background, email/password inputs
- **Register** - Account creation form
- **Forgot Password** - Password reset
- **Setup Overview** - Step 1/4 (Shopify flow)
- **Add Product** - Step 2/4
- **Shipping & Pricing** - Step 3/4
- **Review Summary** - Step 4/4

## Installation

```bash
cd packages/web/figma-plugin/quantbot-setup
npm install
npm run build
```

## Load in Figma

1. Open Figma Desktop
2. **Plugins** → **Development** → **Import plugin from manifest...**
3. Select `manifest.json` from this directory
4. Plugin appears in **Plugins** → **Development** → **QuantBot Figma Replicas**

## Usage

1. Open or create a Figma file
2. Run: **Plugins** → **Development** → **QuantBot Figma Replicas**
3. Click **"🎨 Create Figma Replicas"**
4. All 7 components will be created horizontally on a new page

## Features

- ✅ Mobile viewport (440×956)
- ✅ Exact replicas of React components
- ✅ Proper colors, fonts, spacing
- ✅ Input fields with borders
- ✅ Buttons with correct styling
- ✅ Progress indicators for multi-step flows

## Based On

React components in:
- `/packages/web/components/sign-in.tsx`
- `/packages/web/components/register-account.tsx`
- `/packages/web/components/forgot-password.tsx`
- `/packages/web/components/setup-overview.tsx`
- `/packages/web/components/add-product.tsx`
- `/packages/web/components/shipping-pricing.tsx`
- `/packages/web/components/review-summary.tsx`
