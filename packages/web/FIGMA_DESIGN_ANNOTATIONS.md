# Content to Add to Figma Design File

Copy these text blocks and paste them into your Figma design as text layers or comments.

---

## Sign In Component (node-id: 7-583)

**Create a text box next to the design with this:**

```
SIGN IN COMPONENT
=================

State Management:
• email: string (stores user email)
• password: string (stores password)

Interactive Elements:
• Email input → onChange updates email state
• Password input → onChange updates password state
• SIGN IN button → navigates to /setup-overview
• REGISTER button → navigates to /register
• "Forgot password?" → navigates to /forgot-password
• "Create Account" → navigates to /register

Validation:
• Email must contain @ and domain
• Passwords must match (on register page)

Code Location:
/web/components/sign-in.tsx

Live Demo:
http://localhost:3000/figma-replicas/sign-in
```

---

## Setup Overview Component (Step 1 of 4)

**Text annotation:**

```
SETUP OVERVIEW - STEP 1/4
=========================

Global State (shared across pages):
• shopName: string → saved to ShopifyFlowContext

Input Field:
• Shop Name input
  - Border: 2px solid #d9d9d9
  - Value stored globally (appears in next steps)
  - onChange → setShopName(value)

Navigation:
• ← BACK → /sign-in
• CONTINUE → → /add-product

Progress: 1 OUT OF 4 COMPLETE

Code: /web/components/setup-overview.tsx
Live: http://localhost:3000/figma-replicas/setup-overview
```

---

## Add Product Component (Step 2 of 4)

**Text annotation:**

```
ADD PRODUCT - STEP 2/4
======================

Local State:
• productName: string
• productImage: string | null (base64)
• productPrice: number (default 39.99)
• showAdded: boolean

Global State (reads):
• shopName (from Step 1)

Global State (writes):
• products[] array

Interactive Elements:

📷 Image Upload:
• Click image area → file picker opens
• Preview shows uploaded image
• Hidden file input (type="file")

📝 Product Name Input:
• Text input, stores in productName

💰 Price Input (Dual):
• Range slider (0-500)
• Number input box
• Both sync to same state value

🔄 ADD ANOTHER Button:
• Saves product to global products[]
• Shows "✓ ADDED!" for 2 seconds
• Resets form fields

Navigation:
• ← BACK → /setup-overview
• CONTINUE → → /shipping-pricing

Progress: 2 OUT OF 4 COMPLETE

Code: /web/components/add-product.tsx
Live: http://localhost:3000/figma-replicas/add-product
```

---

## Shipping & Pricing Component (Step 3 of 4)

**Text annotation:**

```
SHIPPING & PRICING - STEP 3/4
==============================

Local State:
• shippingType: string
• deliveryDays: number
• notes: string
• priceModified: boolean

Interactive Elements:

📦 Shipping Type Dropdown:
Options:
  - Same Day Delivery (0 days)
  - Next Day Delivery (1 day)
  - Standard Shipping (5 days)
  - Economy Shipping (7 days)

Auto-sets delivery days based on selection

⏱️ Delivery Time Selector:
• − button (decrement)
• + button (increment)
• Display: "Same Day" / "1 Day" / "X Days"
• Min: 0 days

📝 Notes Input:
• Optional text field
• Stored in notes state

💵 Price Display:
• Shows "$39.99 ea" placeholder
• Hides after first modification

Navigation:
• ← BACK → /add-product
• REVIEW → /review

Progress: 3 OUT OF 4 COMPLETE

Code: /web/components/shipping-pricing.tsx
Live: http://localhost:3000/figma-replicas/shipping-pricing
```

---

## Review Summary Component (Step 4 of 4)

**Text annotation:**

```
REVIEW SUMMARY - STEP 4/4
=========================

Global State (read-only):
• shopName
• products[] - all added products
• price
• shippingType
• deliveryDays
• notes

Display Sections:

🏪 Shop Name:
• Shows value from Step 1

📦 Products List:
• Dynamic rendering of all products
• Shows image (if uploaded)
• Shows name and price
• Fallback: "No products added yet"

🚚 Shipping Summary:
• Method: Standard Shipping
• Delivery: 1 Day / Same Day / X Days
• Notes: (if any)

Navigation:
• ← BACK TO PRODUCTS → /add-product (allows editing)
• LAUNCH SHOP! 🚀 → /figma-replicas (complete)

Progress: COMPLETE

Code: /web/components/review-summary.tsx
Live: http://localhost:3000/figma-replicas/review
```

---

## Register Account Component

**Text annotation:**

```
REGISTER ACCOUNT
================

State Management:
• email: string
• password: string
• confirmPassword: string
• emailError: string
• passwordError: string
• showSuccess: boolean

Validation Rules:

📧 Email:
• Must contain @
• Must have domain with .
• Must have valid TLD (2+ chars)
• Error shown below input (red text)

🔐 Password Matching:
• Real-time validation (useEffect)
• Shows "Passwords do not match" in red
• Clears when passwords match
• No JavaScript alerts (inline errors)

Navigation:
• SIGN IN → /sign-in
• REGISTER → → /setup-overview (on success)
• "Already have an account?" → /sign-in

Code: /web/components/register-account.tsx
Live: http://localhost:3000/figma-replicas/register
```

---

## Forgot Password Component

**Text annotation:**

```
FORGOT PASSWORD
===============

State Management:
• email: string
• showSuccess: boolean (controls popup)

Flow:
1. User enters email
2. Clicks "SEND EMAIL →"
3. Popup appears:
   ✓ "Email Recovery Sent!"
   Shows entered email
   "Waiting for link to be clicked..."

Popup Features:
• Full-screen dark overlay
• Centered white card
• Green checkmark icon
• "← BACK TO LOGIN" button

Navigation:
• ← BACK → /sign-in
• SEND EMAIL → (shows popup)
• Popup "BACK TO LOGIN" → /sign-in

Code: /web/components/forgot-password.tsx
Live: http://localhost:3000/figma-replicas/forgot-password
```

---

## How to Add These to Figma

### Method 1: Text Layers (Visible in Design)

1. Select **Text tool** (T key)
2. Click next to your component
3. Paste the text above
4. Style it: Small font (10-12px), gray color, monospace font
5. Lock layer (Cmd/Ctrl+Shift+L) so it doesn't move

### Method 2: Comments (Clickable Pins)

1. Select component
2. Press **C** to add comment
3. Paste the text
4. Designers can click the pin to see info

### Method 3: Description Field

1. Select component
2. Right panel → **Description** section
3. Paste the text
4. Visible when component is selected

### Method 4: Component Documentation Panel

1. Select component (must be a Component, not Frame)
2. Right panel → **Documentation** tab
3. Add description, examples, properties

---

## Recommended Layout in Figma

```
┌─────────────────┐     ┌──────────────────────┐
│                 │     │ SIGN IN COMPONENT    │
│  SIGN IN        │ ←── │ State: email, pass   │
│  [Your Design]  │     │ Code: sign-in.tsx    │
│                 │     │ Live: localhost:3000 │
└─────────────────┘     └──────────────────────┘
```

Place the annotation text box to the **right** or **below** each design frame.

