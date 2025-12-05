# Figma Component Specifications
## Detailed Component Specs for Figma Implementation

This document provides pixel-perfect specifications for building components in Figma.

---

## 1. Metric Card

### Dimensions
- **Width:** 280px (flexible in grid)
- **Height:** 160px (auto-height with content)
- **Border Radius:** 12px
- **Padding:** 24px (all sides)

### Structure
```
┌─────────────────────────────────┐
│ [Icon] TITLE          [Trend]   │  ← 24px padding
│                                  │
│      VALUE                      │
│                                  │
│ Description text                │
└─────────────────────────────────┘
```

### Spacing
- Icon to Title: 8px gap
- Title to Value: 16px gap
- Value to Description: 8px gap
- Internal padding: 24px

### Typography
- **Title:** 12px, Medium, #94A3B8, Uppercase, Letter-spacing: 0.5px
- **Value:** 32px, Bold, #FFFFFF (or variant color)
- **Description:** 12px, Regular, #64748B, Line-height: 1.5

### Colors
- **Background:** #1E293B
- **Border:** 1px solid #475569
- **Success Variant:** Border #10B981/50%, Background #10B981/5%
- **Danger Variant:** Border #EF4444/50%, Background #EF4444/5%

### Icons
- Size: 16px × 16px
- Color: #94A3B8
- Position: Left of title, 8px gap

### Trend Indicator
- Size: 12px × 12px icon + text
- Position: Top right
- Colors: #10B981 (up), #EF4444 (down)

---

## 2. Strategy Card

### Dimensions
- **Width:** 100% (container width)
- **Height:** Auto (min 120px)
- **Border Radius:** 12px
- **Padding:** 20px

### Structure
```
┌─────────────────────────────────────────────┐
│ [Active Bar - 1px height, full width]      │
│                                             │
│ [Icon] Strategy Name    [Active Badge]      │  ← 20px padding
│                                             │
│ Description text                            │
│                                             │
│ Category • Status              [Toggle]    │
└─────────────────────────────────────────────┘
```

### Active State Indicator
- **Bar:** 1px height, full width, top position
- **Gradient:** #10B981 → #34D399 (left to right)
- **Background Tint:** #10B981/5%

### Inactive State
- **Border:** 1px solid #475569
- **Background:** #1E293B/50%
- **No top bar**

### Icon Container
- **Size:** 40px × 40px
- **Border Radius:** 8px
- **Padding:** 8px
- **Active:** Background #10B981/20%, Icon #10B981
- **Inactive:** Background #334155, Icon #94A3B8

### Typography
- **Strategy Name:** 16px, Semibold, #FFFFFF
- **Description:** 14px, Regular, #94A3B8, Line-height: 1.5
- **Category:** 12px, Regular, #64748B

### Active Badge
- **Padding:** 4px 8px
- **Border Radius:** 12px
- **Background:** #10B981/20%
- **Border:** 1px solid #10B981/30%
- **Text:** 12px, Medium, #10B981
- **Icon:** 12px × 12px checkmark

### Toggle Switch
- **Width:** 44px
- **Height:** 24px
- **Border Radius:** 12px
- **Active:** Background #10B981
- **Inactive:** Background #475569
- **Thumb:** 20px circle, white, 2px margin

---

## 3. Simulation Card

### Dimensions
- **Width:** 100% (grid column width)
- **Height:** Auto (min 200px)
- **Border Radius:** 12px
- **Padding:** 24px

### Structure
```
┌─────────────────────────────────────┐
│ Name              [Return Badge]   │  ← 24px padding
│ [Date Icon] Date                    │
│                                     │
│ [Trades] [Win Rate] [Final Value]   │
│                                     │
│ ─────────────────────────────────   │
│ [History Icon] History      [→]     │
└─────────────────────────────────────┘
```

### Status Bar
- **Position:** Right edge, full height
- **Width:** 1px
- **Color:** #10B981 (positive) or #EF4444 (negative)

### Return Badge
- **Padding:** 8px 12px
- **Border Radius:** 12px
- **Positive:** Background #10B981/20%, Border #10B981/30%, Text #10B981
- **Negative:** Background #EF4444/20%, Border #EF4444/30%, Text #EF4444
- **Icon:** 12px × 12px (TrendingUp/Down)
- **Text:** 14px, Semibold

### Typography
- **Name:** 18px, Semibold, #FFFFFF
- **Date:** 12px, Regular, #94A3B8
- **Metric Labels:** 12px, Regular, #94A3B8
- **Metric Values:** 16px, Semibold, #FFFFFF

### Metrics Grid
- **Columns:** 3 equal columns
- **Gap:** 16px
- **Alignment:** Left

### Footer
- **Border:** 1px solid #475569 (top)
- **Padding:** 16px 0 0 0
- **Gap:** 8px between elements

---

## 4. Button Component

### Primary Button

**Dimensions:**
- **Height:** 44px
- **Padding:** 12px 24px
- **Border Radius:** 8px
- **Min Width:** 120px

**States:**
- **Default:** Background #6366F1, Text #FFFFFF
- **Hover:** Background #818CF8, Scale 1.02
- **Active:** Background #4F46E5, Scale 0.98
- **Disabled:** Background #475569, Text #64748B, Opacity 0.6

**Typography:**
- **Text:** 14px, Medium, #FFFFFF
- **Icon:** 16px × 16px (if present), 8px gap from text

### Secondary Button

**Same dimensions as Primary:**
- **Default:** Transparent, Border 1px #6366F1, Text #6366F1
- **Hover:** Background #6366F1/10%
- **Active:** Background #6366F1/20%

---

## 5. Input Field

### Dimensions
- **Height:** 44px
- **Padding:** 12px 16px
- **Border Radius:** 8px
- **Border:** 1px solid #475569

### States
- **Default:** Background #0F172A, Border #475569, Text #FFFFFF
- **Focus:** Border 2px #6366F1, Shadow 0 0 0 3px rgba(99, 102, 241, 0.1)
- **Error:** Border 2px #EF4444, Background rgba(239, 68, 68, 0.05)
- **Disabled:** Background #1E293B, Border #334155, Text #64748B

### Typography
- **Text:** 14px, Regular, #FFFFFF
- **Placeholder:** 14px, Regular, #64748B
- **Label:** 14px, Medium, #CBD5E1 (above input, 8px gap)
- **Helper Text:** 12px, Regular, #94A3B8 (below input, 4px gap)

---

## 6. Badge Component

### Status Badge

**Dimensions:**
- **Height:** 24px
- **Padding:** 4px 12px
- **Border Radius:** 12px

**Variants:**
- **Success:** Background #10B981/20%, Border #10B981/30%, Text #10B981
- **Danger:** Background #EF4444/20%, Border #EF4444/30%, Text #EF4444
- **Warning:** Background #F59E0B/20%, Border #F59E0B/30%, Text #F59E0B
- **Info:** Background #3B82F6/20%, Border #3B82F6/30%, Text #3B82F6
- **Neutral:** Background #475569/20%, Border #475569/30%, Text #94A3B8

**Typography:**
- **Text:** 12px, Medium

**With Icon:**
- **Icon:** 12px × 12px
- **Gap:** 4px between icon and text

---

## 7. Card Container

### Base Card

**Dimensions:**
- **Border Radius:** 12px
- **Padding:** 24px
- **Border:** 1px solid #475569

**Background:**
- **Default:** #1E293B
- **Elevated:** #1E293B/50% (with backdrop blur effect)

**Shadow:**
- **Default:** None
- **Hover:** 0 4px 12px rgba(0, 0, 0, 0.3)

**States:**
- **Default:** Border #475569
- **Hover:** Border #64748B, Transform translateY(-2px)
- **Selected:** Border 2px #6366F1

---

## 8. Table Component

### Table Structure

**Header:**
- **Background:** #0F172A
- **Border:** 1px solid #475569 (bottom)
- **Padding:** 12px 16px
- **Text:** 12px, Medium, #94A3B8, Uppercase, Letter-spacing: 0.5px

**Row:**
- **Background:** #1E293B (alternating with #0F172A)
- **Border:** 1px solid #334155 (bottom)
- **Padding:** 12px 16px
- **Hover:** Background #334155

**Cell:**
- **Text:** 14px, Regular, #FFFFFF (or #94A3B8 for secondary)
- **Monospace:** For numbers/addresses

**Border:**
- **Table Border:** 1px solid #475569
- **Border Radius:** 8px (outer container)

---

## 9. Progress Indicator

### Step Indicator

**Dimensions:**
- **Circle:** 32px × 32px
- **Connector:** 2px height, full width between circles
- **Gap:** 16px between steps

**States:**
- **Active:** Background #6366F1, Border #6366F1, Text #FFFFFF
- **Completed:** Background #10B981, Border #10B981, Text #FFFFFF
- **Pending:** Background #475569, Border #475569, Text #94A3B8

**Connector Line:**
- **Completed:** #10B981
- **Pending:** #475569

---

## 10. Live Status Indicator

### Badge

**Dimensions:**
- **Padding:** 8px 16px
- **Border Radius:** 8px
- **Height:** 32px

**Structure:**
```
[Pulsing Dot] "Live"
```

**Dot:**
- **Size:** 8px × 8px
- **Color:** #10B981
- **Animation:** Pulse (scale 1 → 1.2, opacity 1 → 0.5)
- **Gap:** 8px to text

**Background:**
- #10B981/10%
- Border: 1px solid #10B981/20%

**Text:**
- 14px, Medium, #10B981

---

## Spacing Reference

### Component Spacing
- **Card Padding:** 24px
- **Section Gap:** 32px
- **Element Gap:** 16px
- **Tight Gap:** 8px
- **Grid Gap:** 24px (dashboard), 16px (forms)

### Internal Spacing
- **Icon to Text:** 8px
- **Label to Input:** 8px
- **Input to Helper:** 4px
- **Section Header Margin:** 24px bottom

---

## Color Reference (Hex Codes)

### Backgrounds
- `#0F172A` - Primary background
- `#1E293B` - Secondary background
- `#334155` - Tertiary background
- `#475569` - Border/divider

### Text
- `#FFFFFF` - Primary text
- `#CBD5E1` - Secondary text
- `#94A3B8` - Tertiary text
- `#64748B` - Muted text

### Accents
- `#6366F1` - Primary/Interactive
- `#10B981` - Success
- `#EF4444` - Danger
- `#F59E0B` - Warning
- `#3B82F6` - Info

### Opacity Variants
- `/10` = 10% opacity
- `/20` = 20% opacity
- `/30` = 30% opacity
- `/50` = 50% opacity

---

## Typography Scale

### Sizes
- **48px** - Display (3rem)
- **36px** - H1 (2.25rem)
- **30px** - H2 (1.875rem)
- **24px** - H3 (1.5rem)
- **20px** - H4 (1.25rem)
- **18px** - Body Large (1.125rem)
- **16px** - Body (1rem)
- **14px** - Body Small (0.875rem)
- **12px** - Caption/Label (0.75rem)

### Weights
- **Regular:** 400
- **Medium:** 500
- **Semibold:** 600
- **Bold:** 700

### Line Heights
- **Tight:** 1.2
- **Normal:** 1.5
- **Relaxed:** 1.75

---

## Border Radius

- **Small:** 4px
- **Medium:** 8px
- **Large:** 12px
- **Extra Large:** 16px
- **Full:** 9999px (for pills/badges)

---

## Shadows

- **Small:** `0 1px 2px rgba(0, 0, 0, 0.1)`
- **Medium:** `0 4px 6px rgba(0, 0, 0, 0.2)`
- **Large:** `0 10px 15px rgba(0, 0, 0, 0.3)`
- **Focus Ring:** `0 0 0 3px rgba(99, 102, 241, 0.1)`

---

## Animation Specs

### Transitions
- **Duration:** 250ms (standard)
- **Easing:** `cubic-bezier(0.4, 0, 0.2, 1)`

### Hover Effects
- **Scale:** 1.02 (buttons, cards)
- **Translate:** -2px Y (cards)
- **Border Color:** Lighter shade

### Loading States
- **Spinner:** 1s linear infinite rotation
- **Pulse:** 2s ease-in-out infinite

---

## Implementation Checklist

When building in Figma:

- [ ] Set up color variables
- [ ] Create text styles
- [ ] Use Auto Layout for all components
- [ ] Set up component variants for states
- [ ] Add constraints for responsive behavior
- [ ] Create component instances
- [ ] Set up prototyping connections
- [ ] Test interactions
- [ ] Export assets at multiple sizes
- [ ] Document component usage

---

**Use these specs as reference when building components in Figma for pixel-perfect accuracy.**

