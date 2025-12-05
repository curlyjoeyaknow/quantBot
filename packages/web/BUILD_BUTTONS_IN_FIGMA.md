# How to Build +/- Buttons in Figma

## What You're Creating

```
┌──────────────────────────────┐
│  −     1 Day      +         │  ← This component
└──────────────────────────────┘
 ↑                        ↑
Circle button        Circle button
```

---

## Step-by-Step in Figma

### 1. Create the Container Frame

1. Press **F** (Frame tool)
2. Click and drag to create a rectangle: **366px wide × 70px tall**
3. Name it: "Delivery Time Selector"
4. Fill: `#b8e0d2` (mint green)
5. Corner radius: 8px (optional)

---

### 2. Create the MINUS (−) Button

1. Press **O** (Ellipse tool)
2. Hold **Shift** and drag to create a perfect circle: **40px × 40px**
3. Position: **Left side** of the container (about 12px from left edge)
4. **Fill:** `#0a3a32` (dark teal)
5. Name it: "Minus Button"

6. Add the minus symbol:
   - Press **T** (Text tool)
   - Click center of the circle
   - Type: **−** (minus sign, or just a dash -)
   - Font size: **24px**
   - Font weight: **Bold**
   - Color: **White** (#ffffff)
   - Align: **Center** (both horizontal and vertical)

---

### 3. Create the Display Text

1. Press **T** (Text tool)
2. Click in the **center** of the container
3. Type: **1 Day** (or "Same Day")
4. Style:
   - Font: Albert Sans or Inter
   - Size: **20px**
   - Weight: **Semibold**
   - Color: `#0a3a32` (dark teal)
   - Align: **Center**
5. Name it: "Delivery Text"

---

### 4. Create the PLUS (+) Button

1. Press **O** (Ellipse tool)
2. Hold **Shift** and drag: **40px × 40px** circle
3. Position: **Right side** of container (about 12px from right edge)
4. **Fill:** `#0a3a32` (dark teal)
5. Name it: "Plus Button"

6. Add the plus symbol:
   - Press **T** (Text tool)
   - Click center of the circle
   - Type: **+**
   - Font size: **24px**
   - Font weight: **Bold**
   - Color: **White** (#ffffff)
   - Align: **Center**

---

### 5. Align Everything (Important!)

1. **Select all 3 elements** (both buttons + text):
   - Shift+Click each one

2. **Use Auto Layout** (recommended):
   - Press **Shift+A** (creates auto layout)
   - Spacing between items: **16px**
   - Padding: **12px** (top/bottom), **16px** (left/right)
   - Alignment: Horizontal, space-between

3. **Or manually align**:
   - Select all 3
   - Top toolbar → **Align vertical centers**
   - Manually adjust horizontal spacing

---

### 6. Group It (Optional)

1. Select the container + all elements inside
2. Press **Ctrl+G** (or Cmd+G on Mac)
3. Name the group: "Delivery Time Component"

---

### 7. Make It Interactive (Optional - Prototype)

If you want to show the interaction in Figma:

1. Switch to **Prototype** mode (top right)
2. Select the **+ button**
3. Drag the **blue node** to a different state/frame (showing "2 Days")
4. Action: **On click** → Navigate to → Frame with "2 Days"
5. Repeat for **− button**

---

## Quick Specs for Figma

Copy these exact values when building:

```
CONTAINER (Frame):
─────────────────
Width: 366px
Height: 70px
Fill: #b8e0d2
Corner radius: 8px
Position: x=55, y=569 (from design)

MINUS BUTTON (Circle):
─────────────────────
Size: 40px × 40px
Fill: #0a3a32
Text: − (minus)
Text size: 24px
Text color: #ffffff
Position: Left side, 12px padding

DISPLAY TEXT:
────────────
Text: "1 Day" (or "Same Day" / "X Days")
Font: Inter Semibold or Albert Sans
Size: 20px
Color: #0a3a32
Position: Center

PLUS BUTTON (Circle):
────────────────────
Size: 40px × 40px
Fill: #0a3a32
Text: + (plus)
Text size: 24px
Text color: #ffffff
Position: Right side, 12px padding
```

---

## Component Properties (Advanced)

If you want to make it a **Figma Component** with variants:

1. Select your delivery time group
2. Press **Ctrl+Alt+K** (create component)
3. Add **Component Properties**:
   - Property: "Days" (number, default: 1)
   - Property: "Text" (text, default: "1 Day")
4. Create **Variants**:
   - Variant 1: Days=0, Text="Same Day"
   - Variant 2: Days=1, Text="1 Day"
   - Variant 3: Days=2, Text="2 Days"
   - etc.

---

## What NOT to Do

❌ Don't try to make it actually functional in Figma (Figma designs are static)
❌ Don't add real code to Figma (code only works in React)
✅ DO create the visual design of the buttons
✅ DO add text annotations explaining how they work

The actual functionality (incrementing numbers) only works in the React code, which is already done!

