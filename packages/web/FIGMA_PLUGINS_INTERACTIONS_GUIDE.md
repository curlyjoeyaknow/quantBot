# Figma Plugins - Interactions Guide

## Prototyping Flows Added to Both Plugins

Both mobile and desktop plugins now automatically create clickable prototypes with navigation between screens.

---

## Mobile Plugin Interactions

### Flow Map

```
Sign In
├─→ SIGN IN button → Setup Overview (Step 1)
├─→ REGISTER button → Register
└─→ Create Account link → Register

Register
└─→ REGISTER button → Email Already Registered (example flow)

Email Already Registered
├─→ SIGN IN INSTEAD → Sign In
├─→ RESET PASSWORD → Forgot Password
└─→ TRY DIFFERENT EMAIL → Register

Setup Overview (Step 1)
├─→ CONTINUE → → Add Product (Step 2)
└─→ ← BACK → Sign In

Add Product (Step 2)
└─→ ADD ANOTHER → Shipping & Pricing (Step 3)

Shipping & Pricing (Step 3)
└─→ CONTINUE → → Review (Step 4)

Review Summary (Step 4)
├─→ BACK TO PRODUCTS → Add Product
└─→ LAUNCH SHOP → (end of flow)

Error Screen
├─→ TRY AGAIN → (refresh/retry)
└─→ GO BACK → Sign In
```

---

## Desktop Plugin Interactions

Same navigation flow as mobile, adapted for desktop layouts:

```
Desktop Sign In
├─→ Sign In button → Desktop Setup Overview
└─→ Create Account button → Desktop Register

Desktop Register
└─→ Create Account → Desktop Email Already Registered

Desktop Email Already Registered
├─→ SIGN IN INSTEAD → Desktop Sign In
├─→ RESET PASSWORD → Desktop Forgot Password
└─→ TRY DIFFERENT EMAIL → Desktop Register

Desktop Setup Overview
├─→ CONTINUE → → Desktop Add Product
└─→ ← BACK → Desktop Sign In

Desktop Add Product
└─→ ADD ANOTHER → Desktop Shipping & Pricing

Desktop Shipping & Pricing  
└─→ CONTINUE → → Desktop Review Summary

Desktop Review Summary
├─→ ← BACK TO PRODUCTS → Desktop Add Product
└─→ LAUNCH SHOP → (end)

Desktop Error Screen
└─→ GO BACK → Desktop Sign In
```

---

## How to Test Interactions

### In Figma:

1. **Run the plugin** to create screens
2. **Enter Present Mode:**
   - Click the **Play** button (top right)
   - Or press `Shift + Space`
3. **Click buttons** to navigate between screens
4. **Use back buttons** to return to previous steps
5. **Test the complete flow** from Sign In → Review

### Flow to Test:

1. Start at "Sign In"
2. Click "SIGN IN" → Goes to "Setup Overview"
3. Click "CONTINUE →" → Goes to "Add Product"
4. Click "ADD ANOTHER" → Goes to "Shipping & Pricing"
5. Click "CONTINUE →" → Goes to "Review Summary"
6. Click "← BACK TO PRODUCTS" → Returns to "Add Product"
7. Click "LAUNCH SHOP" → End of flow

---

## Transition Details

All interactions use:
- **Type:** Smart Animate
- **Duration:** 0.3 seconds
- **Easing:** Ease In And Out
- **Navigation:** Navigate (replaces current frame)

---

## Error Flow Testing

### Register → Email Already Registered:
1. Go to "Register" screen
2. Click "REGISTER" → Shows "Email Already Registered"
3. Choose an option:
   - "SIGN IN INSTEAD" → Goes to Sign In
   - "RESET PASSWORD" → Goes to Forgot Password
   - "TRY DIFFERENT EMAIL" → Back to Register

### Error Screen:
1. Can be accessed from any error state
2. "GO BACK" → Returns to Sign In
3. "TRY AGAIN" → Refreshes current screen

---

## Prototyping Notes

### What Works:
- ✅ Button clicks navigate to next screen
- ✅ Back buttons return to previous screen
- ✅ Smooth Smart Animate transitions
- ✅ Complete flow from start to finish
- ✅ Error state handling

### Manual Adjustments Needed:
- Form validation (visual states only)
- Input field interactions (placeholder text)
- Hover states (add manually in Figma)
- Success messages (add as variants)

---

## Adding More Interactions

To add more interactions after plugin runs:

1. **Select an element** (button, link, etc.)
2. **Go to Prototype tab** (right sidebar)
3. **Click "+"** next to Interactions
4. **Set:**
   - Trigger: On Click
   - Action: Navigate to → [Select target frame]
   - Animation: Smart Animate
   - Duration: 300ms
   - Easing: Ease In And Out

---

## Complete Flow Diagram

```
┌─────────────┐
│  Sign In    │
└──────┬──────┘
       │ SIGN IN
       ↓
┌─────────────┐     CONTINUE →     ┌─────────────┐
│ Setup       │───────────────────→│ Add Product │
│ Overview    │                    │  (Step 2)   │
└─────────────┘                    └──────┬──────┘
                                         │ ADD ANOTHER
                                         ↓
                                   ┌─────────────┐
                                   │  Shipping & │
                                   │   Pricing   │
                                   └──────┬──────┘
                                         │ CONTINUE
                                         ↓
                                   ┌─────────────┐
                                   │   Review    │
                                   │   Summary   │
                                   └─────────────┘
```

---

## Interaction Count

- **Mobile Plugin:** 13+ interactions
- **Desktop Plugin:** 13+ interactions
- **Total:** 26+ clickable prototypes

---

**All interactions are automatically created by the plugins!**

Just run the plugin, enter Present mode (Shift + Space), and click through the flow.

