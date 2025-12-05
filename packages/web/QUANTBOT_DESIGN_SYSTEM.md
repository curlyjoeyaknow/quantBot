# QuantBot Design System
## Complete Design Specification for New Figma Designs

This document provides comprehensive design specifications for creating a new Figma design file for the QuantBot trading platform.

---

## Design Philosophy

**Modern Trading Platform Aesthetic**
- Dark theme optimized for extended viewing
- High contrast for data readability
- Professional, institutional-grade appearance
- Clear visual hierarchy for complex financial data
- Responsive and accessible

---

## Color Palette

### Primary Colors
```
Background:
- Primary: #0F172A (slate-900)
- Secondary: #1E293B (slate-800)
- Tertiary: #334155 (slate-700)
- Elevated: #475569 (slate-600)

Text:
- Primary: #FFFFFF (white)
- Secondary: #CBD5E1 (slate-300)
- Tertiary: #94A3B8 (slate-400)
- Muted: #64748B (slate-500)

Accent Colors:
- Success/Profit: #10B981 (emerald-500)
- Success/Light: #34D399 (emerald-400)
- Danger/Loss: #EF4444 (red-500)
- Danger/Light: #F87171 (red-400)
- Warning: #F59E0B (amber-500)
- Info: #3B82F6 (blue-500)
- Info/Light: #60A5FA (blue-400)

Interactive:
- Primary Button: #6366F1 (indigo-500)
- Primary Hover: #818CF8 (indigo-400)
- Secondary Button: #334155 (slate-700)
- Border: #475569 (slate-600)
- Border Hover: #64748B (slate-500)
```

### Status Colors
```
Active: #10B981 (emerald-500)
Inactive: #64748B (slate-500)
Pending: #F59E0B (amber-500)
Error: #EF4444 (red-500)
```

---

## Typography

### Font Families
- **Primary**: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
- **Monospace**: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace (for addresses, numbers)

### Type Scale
```
Display: 48px / 56px (3rem / 3.5rem) - Bold
H1: 36px / 44px (2.25rem / 2.75rem) - Bold
H2: 30px / 38px (1.875rem / 2.375rem) - Semibold
H3: 24px / 32px (1.5rem / 2rem) - Semibold
H4: 20px / 28px (1.25rem / 1.75rem) - Medium
Body Large: 18px / 28px (1.125rem / 1.75rem) - Regular
Body: 16px / 24px (1rem / 1.5rem) - Regular
Body Small: 14px / 20px (0.875rem / 1.25rem) - Regular
Caption: 12px / 16px (0.75rem / 1rem) - Regular
Label: 12px / 16px (0.75rem / 1rem) - Medium
```

---

## Spacing System

### Base Unit: 4px
```
xs: 4px (0.25rem)
sm: 8px (0.5rem)
md: 16px (1rem)
lg: 24px (1.5rem)
xl: 32px (2rem)
2xl: 48px (3rem)
3xl: 64px (4rem)
```

### Component Spacing
- Card Padding: 24px (lg)
- Section Gap: 32px (xl)
- Element Gap: 16px (md)
- Tight Gap: 8px (sm)

---

## Component Specifications

### 1. Trading Dashboard

**Layout:**
- Full-width container (max-width: 1920px)
- Grid: 4 columns on desktop, 2 on tablet, 1 on mobile
- Card spacing: 16px gap

**Metric Cards:**
- Size: 280px × 160px
- Border radius: 12px
- Border: 1px solid #475569
- Background: #1E293B
- Padding: 24px
- Shadow: None (flat design)

**Card Content:**
- Title: 12px, #94A3B8, Medium, uppercase, letter-spacing: 0.5px
- Value: 32px, #FFFFFF, Bold
- Description: 12px, #64748B, Regular
- Status indicator: 4px dot, left of value

**Profit/Loss Indicators:**
- Positive: #10B981
- Negative: #EF4444
- Neutral: #FFFFFF

---

### 2. Strategy Configuration Panel

**Layout:**
- Width: 100% (max-width: 1200px)
- Background: #1E293B
- Border radius: 16px
- Padding: 32px
- Border: 1px solid #475569

**Strategy Card:**
- Background: #0F172A
- Border: 1px solid #334155
- Border radius: 12px
- Padding: 20px
- Gap between cards: 16px

**Toggle Switch:**
- Width: 44px
- Height: 24px
- Active: #10B981
- Inactive: #475569
- Thumb: 20px circle, white

**Input Fields:**
- Height: 44px
- Border: 1px solid #475569
- Border radius: 8px
- Background: #0F172A
- Padding: 12px 16px
- Font: 14px, #FFFFFF
- Focus border: #6366F1

---

### 3. Simulation Results View

**Layout:**
- Two-column layout (70/30 split)
- Left: Results table/chart
- Right: Details panel

**Results Table:**
- Header background: #0F172A
- Row background: #1E293B (alternating)
- Row hover: #334155
- Border: 1px solid #475569
- Cell padding: 16px
- Font: 14px

**Chart Container:**
- Background: #0F172A
- Border: 1px solid #475569
- Border radius: 12px
- Padding: 24px
- Height: 400px (min)

**Details Panel:**
- Background: #1E293B
- Border: 1px solid #475569
- Border radius: 12px
- Padding: 24px
- Sticky positioning

---

### 4. Live Trading Monitor

**Layout:**
- Real-time data stream
- Auto-refresh indicators
- Status badges

**Status Badge:**
- Size: 24px height
- Border radius: 12px
- Padding: 4px 12px
- Font: 12px, Medium

**Active Badge:**
- Background: #10B981 / 20% opacity
- Text: #10B981
- Border: 1px solid #10B981 / 40% opacity

**Inactive Badge:**
- Background: #64748B / 20% opacity
- Text: #64748B
- Border: 1px solid #64748B / 40% opacity

---

### 5. Backtest Configuration Form

**Layout:**
- Multi-step wizard
- Progress indicator at top
- Step content: max-width 600px, centered

**Progress Steps:**
- Active: #6366F1
- Completed: #10B981
- Pending: #475569
- Step indicator: 32px circle
- Connector line: 2px, #475569

**Form Groups:**
- Label: 14px, #CBD5E1, Medium
- Input: 44px height
- Helper text: 12px, #94A3B8
- Error text: 12px, #EF4444

**Action Buttons:**
- Primary: #6366F1 background, white text
- Secondary: Transparent, #6366F1 border
- Height: 44px
- Border radius: 8px
- Padding: 12px 24px
- Font: 14px, Medium

---

### 6. Portfolio Overview

**Layout:**
- Summary cards at top
- Holdings table below
- Performance chart

**Summary Cards:**
- 4-column grid
- Total Value, 24h Change, Total PnL, Active Positions
- Large numbers: 28px, Bold
- Labels: 12px, #94A3B8

**Holdings Table:**
- Sortable columns
- Token icon: 32px × 32px
- Symbol: 16px, Bold
- Price: 14px, Monospace
- Change: Color-coded (green/red)
- Actions: Icon buttons

---

## Interactive States

### Buttons
```
Default:
- Background: #6366F1
- Text: #FFFFFF
- Border: None

Hover:
- Background: #818CF8
- Transform: scale(1.02)

Active:
- Background: #4F46E5
- Transform: scale(0.98)

Disabled:
- Background: #475569
- Text: #64748B
- Opacity: 0.6
```

### Cards
```
Default:
- Background: #1E293B
- Border: 1px solid #475569

Hover:
- Border: 1px solid #64748B
- Transform: translateY(-2px)
- Shadow: 0 4px 12px rgba(0, 0, 0, 0.3)

Selected:
- Border: 2px solid #6366F1
- Background: #1E293B
```

### Inputs
```
Default:
- Border: 1px solid #475569
- Background: #0F172A

Focus:
- Border: 2px solid #6366F1
- Outline: None
- Shadow: 0 0 0 3px rgba(99, 102, 241, 0.1)

Error:
- Border: 2px solid #EF4444
- Background: rgba(239, 68, 68, 0.05)
```

---

## Icons & Graphics

### Icon Style
- Line weight: 1.5px
- Size: 20px (standard), 16px (small), 24px (large)
- Color: Inherit from parent or #94A3B8

### Chart Colors
```
Primary line: #6366F1
Secondary line: #10B981
Grid lines: #334155
Background: #0F172A
Tooltip: #1E293B with border #475569
```

---

## Responsive Breakpoints

```
Mobile: 320px - 767px
Tablet: 768px - 1023px
Desktop: 1024px - 1919px
Large Desktop: 1920px+
```

### Mobile Adaptations
- Single column layouts
- Stacked cards
- Collapsible sections
- Bottom navigation
- Touch-friendly targets (min 44px)

---

## Animation & Transitions

### Timing
- Fast: 150ms
- Normal: 250ms
- Slow: 350ms

### Easing
- Default: cubic-bezier(0.4, 0, 0.2, 1)
- Enter: cubic-bezier(0, 0, 0.2, 1)
- Exit: cubic-bezier(0.4, 0, 1, 1)

### Common Animations
- Fade in: opacity 0 → 1
- Slide up: translateY(8px) → 0
- Scale: scale(0.95) → 1
- Loading spinner: 1s linear infinite rotation

---

## Accessibility

### Contrast Ratios
- Normal text: 4.5:1 minimum
- Large text: 3:1 minimum
- Interactive elements: 3:1 minimum

### Focus Indicators
- 2px solid outline
- Color: #6366F1
- Offset: 2px

### Screen Reader Support
- Semantic HTML
- ARIA labels where needed
- Alt text for icons/images
- Live regions for updates

---

## Figma Design File Structure

### Pages
1. **Design System** - Colors, typography, components
2. **Dashboard** - Main trading dashboard
3. **Strategies** - Strategy configuration
4. **Simulations** - Backtest results
5. **Live Trading** - Real-time monitoring
6. **Portfolio** - Holdings and performance
7. **Settings** - Configuration panels

### Components Library
- Buttons (Primary, Secondary, Danger, Ghost)
- Cards (Metric, Strategy, Result)
- Inputs (Text, Number, Select, Switch)
- Badges (Status, Count, Label)
- Tables (Data, Sortable)
- Charts (Line, Bar, Area)
- Navigation (Tabs, Sidebar, Breadcrumbs)
- Modals (Dialog, Confirmation, Info)

---

## Design Tokens (Figma Variables)

### Colors
- `color.background.primary`
- `color.background.secondary`
- `color.text.primary`
- `color.text.secondary`
- `color.accent.primary`
- `color.accent.success`
- `color.accent.danger`

### Spacing
- `spacing.xs` through `spacing.3xl`

### Typography
- `font.family.primary`
- `font.family.mono`
- `font.size.*` (all sizes)
- `font.weight.*` (regular, medium, semibold, bold)

### Border Radius
- `radius.sm`: 4px
- `radius.md`: 8px
- `radius.lg`: 12px
- `radius.xl`: 16px

### Shadows
- `shadow.sm`: 0 1px 2px rgba(0, 0, 0, 0.1)
- `shadow.md`: 0 4px 6px rgba(0, 0, 0, 0.2)
- `shadow.lg`: 0 10px 15px rgba(0, 0, 0, 0.3)

---

## Implementation Notes

1. **Use Auto Layout** for all components
2. **Create Component Variants** for states (default, hover, active, disabled)
3. **Use Constraints** for responsive behavior
4. **Set up Variables** for colors and spacing
5. **Create Styles** for text and effects
6. **Use Frames** for page layouts (1920px width for desktop)
7. **Add Prototyping** for interactive flows
8. **Export Assets** at 1x, 2x, 3x for icons

---

## Next Steps

1. Create new Figma file: "QuantBot Trading Platform"
2. Set up design system page with all tokens
3. Build component library
4. Create page layouts
5. Add interactions and prototypes
6. Export design specs for development

