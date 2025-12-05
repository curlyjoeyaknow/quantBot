# Shipping Page - All Components Documented

## 🎯 What's Already on the Shipping Page

### Component 1: Price Input (Line 279-289)
**Location:** Top left with number badge "1"

**Type:** Number input field
```tsx
<input
  type="number"
  value={price}
  onChange={(e) => handlePriceChange(e.target.value)}
/>
```

**What it does:**
- Shows $ symbol before input
- Shows "ea" after input  
- User can type any price
- Hides placeholder "$39.99 ea" once modified

---

### Component 2: Shipping Type Dropdown (Line 292-304)
**Location:** Second row with badge "2"

**Type:** Select dropdown
```tsx
<select
  value={shippingType}
  onChange={(e) => handleShippingTypeChange(e.target.value)}
>
  <option>Same Day Delivery</option>
  <option>Next Day Delivery</option>
  <option>Express Shipping</option>
  <option>Standard Shipping</option>
  <option>International Shipping</option>
  <option>Free Shipping</option>
</select>
```

**What it does:**
- Click to see 6 options
- Auto-updates delivery days when selected:
  - Same Day Delivery → 0 days
  - Next Day Delivery → 1 day
  - Express Shipping → 2 days
  - Standard Shipping → 5 days
  - International → 10 days
  - Free Shipping → 7 days

---

### Component 3: Delivery Time Selector (Line 307-325)
**Location:** Third row with badge "3"

**Type:** Increment/Decrement buttons
```tsx
<div>
  <button onClick={handleDeliveryDecrement}>−</button>
  <span>{getDeliveryText()}</span>
  <button onClick={handleDeliveryIncrement}>+</button>
</div>
```

**What it does:**
- **− button:** Decreases days (min 0)
- **+ button:** Increases days (max 30)
- **Display:** Smart text
  - 0 days → "Same Day"
  - 1 day → "1 Day"
  - 2+ days → "2 Days", "3 Days", etc.

---

### Component 4: Notes Input (Line 328-336)
**Location:** Fourth row with badge "4"

**Type:** Text input
```tsx
<input
  type="text"
  value={notes}
  onChange={(e) => setNotes(e.target.value)}
  placeholder="Additional notes..."
/>
```

**What it does:**
- Single-line text input
- Optional field
- Saves to global state

---

### Component 5: Back Button (Line 265-271)
**Location:** Next to "SHIPPING & PRICING" title

**Type:** Link button (circular)
```tsx
<a href="/figma-replicas/add-product">
  ←
</a>
```

**What it does:**
- 40px circular white button
- Left arrow symbol
- Returns to Add Product page

---

### Component 6: REVIEW Button (Line 184-202)
**Location:** Bottom center

**Type:** Link button
```tsx
<a href="/figma-replicas/review">
  REVIEW
</a>
```

**What it does:**
- Large button (398px wide)
- Navigates to Review Summary page
- Hover effect (darkens)

---

## 📋 Copy This to Figma

**Paste next to your Shipping & Pricing design:**

```
SHIPPING & PRICING - Interactive Components
============================================

1️⃣ PRICE INPUT (top)
   Type: number
   Format: $XX.XX ea
   Action: User types price
   State: price (string)

2️⃣ SHIPPING TYPE (dropdown)
   Type: select
   Options: 6 choices
   Auto-sets: Delivery days
   State: shippingType (string)

3️⃣ DELIVERY TIME (increment/decrement)
   Type: buttons (− and +)
   Range: 0-30 days
   Display: "Same Day" / "1 Day" / "X Days"
   State: deliveryDays (number)

4️⃣ NOTES (text input)
   Type: text
   Optional: yes
   State: notes (string)

🔙 BACK BUTTON (circular, top)
   → Returns to Add Product page

✅ REVIEW BUTTON (bottom)
   → Goes to Review Summary page

File: /web/components/shipping-pricing.tsx
Live: localhost:3000/figma-replicas/shipping-pricing
```

---

## 🎨 How to Add to Figma

### Option 1: Text Layer Next to Design
1. Press **T** (text tool)
2. Click to the right of your design
3. Paste the text above
4. Font: 10-12px, gray color

### Option 2: Comment Pin
1. Select the component
2. Press **C** (comment)
3. Paste the text
4. Creates clickable 📍 pin

### Option 3: Description Field
1. Select component in layers
2. Right panel → **Description**
3. Paste the text

---

## State Flow Diagram (for Figma)

```
User Action              →  State Update         →  Visual Change
─────────────────────────────────────────────────────────────────
Types in price field     →  setPrice()           →  Number updates
Selects dropdown         →  setShippingType()    →  Auto-sets days
Clicks + button          →  setDeliveryDays(+1)  →  "2 Days" appears
Clicks − button          →  setDeliveryDays(-1)  →  "Same Day" appears
Types in notes           →  setNotes()           →  Text saved
```

Paste this diagram into Figma to show developers how it works!

