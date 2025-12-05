# Figma Publish Checklist ✅

Use this checklist to publish all components to Figma.

## ☐ Step 1: Duplicate Frames in Figma

Go to: https://www.figma.com/design/dfD3nN79LuyG7Fjs6BnDxZ/Shopify

Duplicate each frame (right-click → Duplicate):

- [ ] Sign In → "SIGN IN - Code"
- [ ] Register (or create new) → "REGISTER - Code"  
- [ ] Forgot Password (or create new) → "FORGOT PASSWORD - Code"
- [ ] Setup Overview → "SETUP OVERVIEW - Code"
- [ ] Add Product → "ADD PRODUCT - Code"
- [ ] Shipping & Pricing → "SHIPPING AND PRICING - Code"
- [ ] Review (or create new) → "REVIEW - Code"

## ☐ Step 2: Get Node IDs

For each duplicated frame:

- [ ] Sign In - Code: node-id = `___-___`
- [ ] Register - Code: node-id = `___-___`
- [ ] Forgot Password - Code: node-id = `___-___`
- [ ] Setup Overview - Code: node-id = `___-___`
- [ ] Add Product - Code: node-id = `___-___`
- [ ] Shipping & Pricing - Code: node-id = `___-___`
- [ ] Review - Code: node-id = `___-___`

(Right-click frame → Copy link → extract `node-id=XXX-XXX` from URL)

## ☐ Step 3: Update Code Connect Files

Update these files with the node-ids above:

- [ ] `components/sign-in.figma.tsx` - Line 16
- [ ] `components/register-account.figma.tsx` - Line 16
- [ ] `components/forgot-password.figma.tsx` - Line 16
- [ ] `components/setup-overview.figma.tsx` - Line 16
- [ ] `components/add-product.figma.tsx` - Line 16
- [ ] `components/shipping-pricing.figma.tsx` - Line 16
- [ ] `components/review-summary.figma.tsx` - Line 16

Change `node-id=XXX-XXXX` to your actual node-id.

## ☐ Step 4: Publish to Figma

```bash
cd /home/memez/quantBot/web
./scripts/publish-to-figma.sh
```

Or manually:
```bash
cd /home/memez/quantBot/web
npx figma connect auth    # First time only
npx figma connect publish
```

## ☐ Step 5: Verify in Figma

- [ ] Open Figma file
- [ ] Enable Dev Mode
- [ ] Click "SIGN IN - Code" → See React code ✓
- [ ] Click "REGISTER - Code" → See React code ✓
- [ ] Click "FORGOT PASSWORD - Code" → See React code ✓
- [ ] Click "SETUP OVERVIEW - Code" → See React code ✓
- [ ] Click "ADD PRODUCT - Code" → See React code ✓
- [ ] Click "SHIPPING AND PRICING - Code" → See React code ✓
- [ ] Click "REVIEW - Code" → See React code ✓

## 🎉 Done!

Your code is now visible in Figma Dev Mode!

## 📝 Notes

- Originals remain design-only (no code attached)
- Duplicates show your React implementation
- Designers can edit originals without affecting published code
- Re-publish anytime with: `npx figma connect publish`

