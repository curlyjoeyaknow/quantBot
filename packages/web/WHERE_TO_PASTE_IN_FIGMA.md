# Where to Paste Dropdown Options in Figma

## Visual Guide

```
Figma Canvas Layout:

┌─────────────────────────────────┐
│  SHIPPING & PRICING (Component) │
│  ┌───────────────────┐          │
│  │ 1  $39.99 ea     │          │ ← Price input
│  ├───────────────────┤          │
│  │ 2  Standard Ship │▼│        │ ← Shipping dropdown (THIS ONE!)
│  ├───────────────────┤          │
│  │ 3  −  1 Day  +   │          │ ← Delivery time
│  ├───────────────────┤          │
│  │ 4  Notes...      │          │ ← Notes input
│  └───────────────────┘          │
└─────────────────────────────────┘

                    ┌─────────────────────────┐
                    │ DROPDOWN OPTIONS:       │ ← Paste HERE!
                    │ • Same Day Delivery     │
                    │ • Next Day Delivery     │
                    │ • Express Shipping      │
                    │ • Standard Shipping     │
                    │ • International         │
                    │ • Free Shipping         │
                    └─────────────────────────┘
```

## Step-by-Step in Figma Desktop

### Method 1: Text Layer (Recommended)

1. **Open Figma:** https://www.figma.com/design/kBMg5IBOJ6RYT1DX0yr7kL/Testt

2. **Find the shipping dropdown** - it's the box with badge "2" and text "Standard Shipping"

3. **Press T** (text tool)

4. **Click to the RIGHT** of the shipping dropdown component (create text box)

5. **Paste this:**
```
Dropdown Options:
─────────────────
1. Same Day Delivery (0 days)
2. Next Day Delivery (1 day)
3. Express Shipping (2 days)
4. Standard Shipping (5 days)
5. International (10 days)
6. Free Shipping (7 days)

Auto-sets delivery time below
```

6. **Style the text:**
   - Font size: 10-12px
   - Color: Gray (#757575)
   - Font: Inter or Monaco (monospace)

7. **Lock the layer:**
   - Press `Ctrl+Shift+L` (so it doesn't move accidentally)

8. **Done!** Developers can see what's in the dropdown

---

### Method 2: Comment Pin

1. **Click** on the shipping dropdown (the rectangle with "2")

2. **Press C** (comment tool)

3. **A comment bubble appears** - paste this:
```
SHIPPING DROPDOWN OPTIONS:

• Same Day Delivery → sets 0 days
• Next Day Delivery → sets 1 day
• Express Shipping → sets 2 days
• Standard Shipping → sets 5 days (default)
• International Shipping → sets 10 days
• Free Shipping → sets 7 days

Selecting an option automatically updates the delivery time in component #3 below.

Code: shipping-pricing.tsx line 292-304
```

4. **Post the comment**

5. **Done!** Comment appears as a clickable pin 📍 on the component

---

### Method 3: Component Description (If it's a Component)

1. **Select** the shipping dropdown rectangle

2. **Right panel** → scroll down to **"Description"**

3. **Paste:**
```
Dropdown with 6 shipping options. Auto-updates delivery time.
Options: Same Day (0d), Next Day (1d), Express (2d), Standard (5d), International (10d), Free (7d)
```

4. **Done!** Description shows when anyone selects the component

---

## For ALL 4 Input Fields

I'll create labels for all of them:

### Component 1 (Price):
```
💰 PRICE INPUT
Type: number
Format: $XX.XX ea
Range: any positive number
Placeholder hides after first edit
```

### Component 2 (Shipping):
```
📦 SHIPPING TYPE
Type: dropdown/select
Options: 6 (see list →)
Auto-sets: delivery days
```

### Component 3 (Delivery):
```
⏱️ DELIVERY TIME
Type: increment/decrement
Buttons: − and +
Range: 0-30 days
Display: Smart ("Same Day"/"X Days")
```

### Component 4 (Notes):
```
📝 NOTES
Type: text input
Optional: yes
Placeholder: "Additional notes..."
```

---

## Quick Copy-Paste for Figma

**Open file:** `/home/memez/quantBot/web/FIGMA_DROPDOWN_ANNOTATION.txt`

**Contains:** Clean, simple version ready to paste!

---

## Summary

**WHERE:** Next to or on top of the dropdown component (the one with badge "2")

**WHAT:** Text describing the 6 options

**HOW:** 
1. Press T (text tool)
2. Click where you want it
3. Paste from `FIGMA_DROPDOWN_ANNOTATION.txt`
4. Style and lock

**That's it!** 🎨

