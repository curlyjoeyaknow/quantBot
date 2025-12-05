# Figma Code Connect Setup

This connects your React components to Figma Dev Mode, so when designers click on components in Figma, they see your actual code!

## ⚠️ IMPORTANT: Duplicate Frames First!

**Before connecting code, duplicate the Figma frames:**

1. Open the Figma file: https://www.figma.com/design/dfD3nN79LuyG7Fjs6BnDxZ/Shopify
2. For each frame, right-click → **Duplicate**:
   - Sign In (node-id=144-2360) → Duplicate as "Sign In - Code"
   - Setup Overview (node-id=218-739) → Duplicate as "Setup Overview - Code"
   - Add Product (node-id=218-762) → Duplicate as "Add Product - Code"
   - Shipping & Pricing (node-id=304-543) → Duplicate as "Shipping & Pricing - Code"
3. **Copy the links** to the duplicated frames (right-click → Copy link)
4. Update the `*.figma.tsx` files with the new node IDs from the duplicates

This keeps the original designs untouched and links code only to the duplicates!

## 🔗 What's Connected

- **Sign In (Code)** → `components/sign-in.tsx`
- **Setup Overview (Code)** → `components/setup-overview.tsx`
- **Add Product (Code)** → `components/add-product.tsx`
- **Shipping & Pricing (Code)** → `components/shipping-pricing.tsx`

## 📦 Publishing to Figma

### 1. Authenticate with Figma

```bash
cd web
npx figma connect auth
```

Follow the browser prompt to log in to your Figma account.

### 2. Publish Code Connections

```bash
npx figma connect publish
```

This uploads the code mappings to Figma's servers.

### 3. Verify in Figma

1. Open the Figma file: https://www.figma.com/design/dfD3nN79LuyG7Fjs6BnDxZ/Shopify
2. Enable **Dev Mode** (top right)
3. Click on any of the **DUPLICATED** frames (the ones you created):
   - Sign In - Code (your duplicated frame)
   - Setup Overview - Code (your duplicated frame)
   - Add Product - Code (your duplicated frame)
   - Shipping & Pricing - Code (your duplicated frame)
4. You should see your React code in the Dev Mode panel!
5. The **original** frames remain code-free for design work

## 🔄 Updating Code

Whenever you update a component:

```bash
npx figma connect publish
```

The updated code will show in Figma Dev Mode.

## 📝 Files to Update After Duplicating

After duplicating frames in Figma, update these files with the new node IDs:

- `components/sign-in.figma.tsx` - Update the URL with duplicated frame's node-id
- `components/setup-overview.figma.tsx` - Update the URL
- `components/add-product.figma.tsx` - Update the URL
- `components/shipping-pricing.figma.tsx` - Update the URL
- `figma.config.json` - Configuration for Code Connect

Example:
```tsx
// Change from original:
figma.connect(Component, 'https://...?node-id=144-2360', {...});

// To duplicated frame (get new node-id from Figma):
figma.connect(Component, 'https://...?node-id=XXX-XXXX', {...});
```

## 🎨 How It Works

Code Connect creates a link between:
- Figma design nodes (by URL/node-id)
- Your actual React component code

When designers click on a component in Figma Dev Mode, they see:
- The exact component code
- Props and usage examples
- Links to your codebase

## 🔍 Debugging

If components don't show up in Figma:

```bash
# Check what will be published
npx figma connect publish --dry-run

# Verify authentication
npx figma connect auth --help
```

## 📚 Learn More

- [Figma Code Connect Docs](https://www.figma.com/developers/code-connect)
- [Code Connect GitHub](https://github.com/figma/code-connect)

