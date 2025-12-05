# Where to Find State Management - Simple Guide

State management = how data is stored and updated when users interact with the page.

---

## 🔍 What to Look For

**State looks like this:**
```tsx
const [email, setEmail] = useState('');
      ↑       ↑           ↑
    variable  function   initial value
             to update
```

**Using state:**
```tsx
// Reading the value
<input value={email} />

// Updating the value
<input onChange={(e) => setEmail(e.target.value)} />
```

---

## 📁 File by File Locations

### 1. Sign In (`sign-in.tsx`)

**Lines 8, 59-60:**
```tsx
import { useState } from 'react';  // ← Line 8

export default function SignIn() {
  const [email, setEmail] = useState('');        // ← Line 59
  const [password, setPassword] = useState('');  // ← Line 60
```

**Where it's used:**
```tsx
// Line 150 - Email input
<input
  type="email"
  value={email}                                    // ← Reading state
  onChange={(e) => setEmail(e.target.value)}      // ← Updating state
/>

// Line 161 - Password input
<input
  type="password"
  value={password}                                 // ← Reading state
  onChange={(e) => setPassword(e.target.value)}   // ← Updating state
/>
```

---

### 2. Register Account (`register-account.tsx`)

**Lines 8, 51-56:**
```tsx
import { useState, useEffect } from 'react';  // ← Line 8

export default function RegisterAccount() {
  const [email, setEmail] = useState('');           // ← Line 51
  const [emailError, setEmailError] = useState(''); // ← Line 52
  const [password, setPassword] = useState('');     // ← Line 53
  const [confirmPassword, setConfirmPassword] = useState(''); // ← Line 54
  const [passwordError, setPasswordError] = useState('');     // ← Line 55
  const [showSuccess, setShowSuccess] = useState(false);      // ← Line 56
```

**Validation Logic (Lines 58-80):**
```tsx
// Email validation function
const validateEmail = (email: string) => {
  if (!email.includes('@')) return 'Email must contain @';
  // ... more validation
  return ''; // No error
};

// Password matching with useEffect (runs automatically)
useEffect(() => {
  if (confirmPassword && password !== confirmPassword) {
    setPasswordError('Passwords do not match');
  } else {
    setPasswordError('');
  }
}, [password, confirmPassword]);  // ← Re-runs when these change
```

**Where it's used:**
```tsx
// Email input with validation
<input
  value={email}
  onChange={(e) => setEmail(e.target.value)}
  onBlur={() => setEmailError(validateEmail(email))}  // ← Check on blur
/>

{emailError && (
  <p className="text-red-600">{emailError}</p>  // ← Show error if exists
)}
```

---

### 3. Setup Overview (`setup-overview.tsx`)

**Lines 8, 15-16:**
```tsx
import { useShopifyFlow } from './shopify-flow-context';  // ← Line 8

export default function SetupOverview() {
  const { state, setShopName } = useShopifyFlow();  // ← Line 15
  const [localShopName, setLocalShopName] = useState(state.shopName);  // ← Line 16
```

**This uses GLOBAL state (shared across all pages):**
```tsx
// When input changes:
onChange={(e) => {
  setLocalShopName(e.target.value);  // ← Update local
  setShopName(e.target.value);       // ← Update global (all pages see it)
}}
```

---

### 4. Add Product (`add-product.tsx`)

**Lines 8, 18-22:**
```tsx
import { useShopifyFlow } from './shopify-flow-context';  // ← Line 8

export default function AddProduct() {
  const { state, addProduct } = useShopifyFlow();         // ← Line 18
  
  const [productName, setProductName] = useState('');     // ← Line 19
  const [productImage, setProductImage] = useState<string | null>(null);  // ← Line 20
  const [productPrice, setProductPrice] = useState(39.99); // ← Line 21
  const [showAdded, setShowAdded] = useState(false);      // ← Line 22
```

**Image upload state:**
```tsx
const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (file) {
    const reader = new FileReader();
    reader.onloadend = () => {
      setProductImage(reader.result as string);  // ← Save image as base64
    };
    reader.readAsDataURL(file);
  }
};
```

**Price slider syncing:**
```tsx
// Slider changes price
<input type="range" 
  value={productPrice}
  onChange={(e) => setProductPrice(parseFloat(e.target.value))}
/>

// Number input also changes price
<input type="number"
  value={productPrice}
  onChange={(e) => setProductPrice(parseFloat(e.target.value))}
/>

// Both update same state = they stay in sync!
```

---

### 5. Shipping & Pricing (`shipping-pricing.tsx`)

**Lines 8, 15-18:**
```tsx
import { useShopifyFlow } from './shopify-flow-context';  // ← Line 8

export default function ShippingAndPricing() {
  const { state, setShippingType, setDeliveryDays, setNotes } = useShopifyFlow();
  
  const [priceModified, setPriceModified] = useState(false);  // ← Line 15
  const [shippingType, setShippingType] = useState('Standard Shipping');  // ← Line 16
  const [deliveryDays, setDeliveryDays] = useState(1);   // ← Line 17
  const [notes, setNotes] = useState('');                 // ← Line 18
```

**Dropdown auto-updates delivery time:**
```tsx
const shippingOptions = [
  { label: 'Same Day Delivery', days: 0 },
  { label: 'Next Day Delivery', days: 1 },
  { label: 'Standard Shipping', days: 5 },
  // ...
];

<select onChange={(e) => {
  setShippingType(e.target.value);
  const option = shippingOptions.find(o => o.label === e.target.value);
  if (option) {
    setDeliveryDays(option.days);  // ← Automatically sets days!
  }
}}>
```

---

### 6. Forgot Password (`forgot-password.tsx`)

**Lines 8, 18-19:**
```tsx
import { useState } from 'react';  // ← Line 8

export default function ForgotPassword() {
  const [email, setEmail] = useState('');          // ← Line 18
  const [showSuccess, setShowSuccess] = useState(false);  // ← Line 19
```

**Popup toggle:**
```tsx
<button onClick={() => setShowSuccess(true)}>  // ← Show popup
  SEND EMAIL →
</button>

{showSuccess && (  // ← Only render when true
  <div className="popup">
    ...
    <button onClick={() => setShowSuccess(false)}>  // ← Hide popup
      BACK TO LOGIN
    </button>
  </div>
)}
```

---

### 7. Review Summary (`review-summary.tsx`)

**Lines 8, 18:**
```tsx
import { useShopifyFlow } from './shopify-flow-context';  // ← Line 8

export default function ReviewSummary() {
  const { state } = useShopifyFlow();  // ← Line 18 (READ ONLY, no updates)
```

**Reading global state:**
```tsx
// Shop name
<h2>Shop: {state.shopName}</h2>

// All products
{state.products.map((product) => (
  <div key={product.id}>
    <img src={product.image} />
    <p>{product.name}</p>
  </div>
))}

// Shipping details
<p>{state.shippingType}</p>
<p>{state.deliveryDays} days</p>
<p>{state.notes}</p>
```

---

## 🌐 Global State (Context)

**File:** `shopify-flow-context.tsx`

**Lines 41-48 - Initial State:**
```tsx
const [state, setState] = useState<ShopifyFlowState>({
  shopName: '',            // ← From Step 1
  products: [],            // ← From Step 2
  price: '39.99',         // ← From Step 2
  shippingType: 'Standard Shipping',  // ← From Step 3
  deliveryDays: 1,        // ← From Step 3
  notes: '',              // ← From Step 3
});
```

**Lines 50-91 - Update Functions:**
```tsx
const setShopName = (name: string) => {
  setState(prev => ({ ...prev, shopName: name }));
};

const addProduct = (product) => {
  setState(prev => ({
    ...prev,
    products: [...prev.products, { ...product, id: Date.now().toString() }]
  }));
};

// ... more functions
```

**This state is available in ALL pages that use `useShopifyFlow()`**

---

## 📖 Quick Reference

| File | State Variables | What They Store |
|------|----------------|-----------------|
| `sign-in.tsx` | email, password | Login credentials (page-local) |
| `register-account.tsx` | email, password, confirmPassword, errors, showSuccess | Registration form + validation (page-local) |
| `forgot-password.tsx` | email, showSuccess | Recovery email + popup state (page-local) |
| `setup-overview.tsx` | Uses `state.shopName` | Shop name (global) |
| `add-product.tsx` | productName, productImage, productPrice, showAdded | Product form (page-local) |
| | Uses `addProduct()` | Saves to global products array |
| `shipping-pricing.tsx` | shippingType, deliveryDays, notes, priceModified | Shipping config (page-local) |
| | Uses `setShippingType()` etc | Saves to global state |
| `review-summary.tsx` | Uses `state` (read-only) | Reads all global state |

---

## 🎯 Simple Summary

**Local State (stays on one page):**
- `useState('')` - defined in the component
- Example: email in sign-in page

**Global State (shared across pages):**
- `useShopifyFlow()` - comes from context
- Example: shopName from Step 1 shows in Step 2

**To find state:** Look for `useState` or `useShopifyFlow` at the top of the component!

