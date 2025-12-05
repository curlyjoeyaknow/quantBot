# Publish All Shopify Screens to Figma

This guide helps you connect all your React components to Figma Dev Mode.

## 📋 Prerequisites

**You MUST duplicate frames in Figma first!** This keeps your original designs clean.

## Step 1: Duplicate Frames in Figma

Open: https://www.figma.com/design/dfD3nN79LuyG7Fjs6BnDxZ/Shopify

For each screen, **right-click → Duplicate** and rename:

| Original Frame | Duplicate As | Original Node ID |
|----------------|--------------|------------------|
| SIGN IN | SIGN IN - Code | 144-2360 |
| REGISTER (create this if needed) | REGISTER - Code | (new) |
| FORGOT PASSWORD (create if needed) | FORGOT PASSWORD - Code | (new) |
| SETUP OVERVIEW | SETUP OVERVIEW - Code | 218-739 |
| ADD PRODUCT | ADD PRODUCT - Code | 218-762 |
| SHIPPING AND PRICING | SHIPPING AND PRICING - Code | 304-543 |
| REVIEW (create if needed) | REVIEW - Code | (new) |

## Step 2: Get New Node IDs

For each **duplicated** frame:
1. Right-click → "Copy link"
2. Extract the node-id from the URL
3. Example: `?node-id=123-456` → note down `123-456`

## Step 3: Update Code Connect Files

Update each `.figma.tsx` file with the duplicated frame's node-id:

```bash
cd web/components
# Edit each *.figma.tsx file and replace the node-id
```

## Step 4: Authenticate with Figma

```bash
cd /home/memez/quantBot/web
npx figma connect auth
```

Follow the browser prompt to log in.

## Step 5: Publish All Components

```bash
npx figma connect publish
```

This publishes:
- ✅ Sign In component
- ✅ Register Account component  
- ✅ Forgot Password component
- ✅ Setup Overview component
- ✅ Add Product component
- ✅ Shipping & Pricing component
- ✅ Review Summary component

## Step 6: Verify in Figma

1. Open the Figma file
2. Enable **Dev Mode** (top right)
3. Click on any **duplicated** frame (the ones ending with "- Code")
4. Your React code should appear in the Dev Mode panel!

## 🔄 Updating Code

Whenever you update a component:

```bash
cd web
npx figma connect publish
```

## 📝 Component Files

All components are in: `/home/memez/quantBot/web/components/`
- `sign-in.tsx` → `sign-in.figma.tsx`
- `register-account.tsx` → `register-account.figma.tsx`
- `forgot-password.tsx` → `forgot-password.figma.tsx`
- `setup-overview.tsx` → `setup-overview.figma.tsx`
- `add-product.tsx` → `add-product.figma.tsx`
- `shipping-pricing.tsx` → `shipping-pricing.figma.tsx`
- `review-summary.tsx` → `review-summary.figma.tsx`

## ⚠️ Important Notes

- Code Connect links to **your duplicates**, not the originals
- Original frames remain design-only
- Designers can edit originals without affecting published code
- You can have multiple code versions linked to different frame duplicates

