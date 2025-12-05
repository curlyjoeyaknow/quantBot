# Creating New Figma Designs for QuantBot
## Step-by-Step Guide

This guide will help you create a completely new Figma design file based on the QuantBot design system and new component designs.

---

## Step 1: Create New Figma File

1. Open Figma Desktop or Web
2. Click **"New Design File"**
3. Name it: **"QuantBot Trading Platform - New Design"**
4. Set frame size to **1920 × 1080** (Desktop) or create multiple frames for different breakpoints

---

## Step 2: Set Up Design System

### Create Design System Page

1. Create a new page called **"🎨 Design System"**
2. Set up the following sections:

#### Colors
Create color styles for:
- Background colors (primary, secondary, tertiary)
- Text colors (primary, secondary, tertiary, muted)
- Accent colors (success, danger, warning, info)
- Interactive colors (primary button, hover states)

**Figma Variables Setup:**
- Go to **Local Variables** (right sidebar)
- Create color variables:
  - `color/background/primary` = #0F172A
  - `color/background/secondary` = #1E293B
  - `color/text/primary` = #FFFFFF
  - `color/accent/success` = #10B981
  - `color/accent/danger` = #EF4444
  - `color/interactive/primary` = #6366F1

#### Typography
Create text styles:
- Display (48px, Bold)
- H1 (36px, Bold)
- H2 (30px, Semibold)
- H3 (24px, Semibold)
- Body (16px, Regular)
- Body Small (14px, Regular)
- Caption (12px, Regular)

**Font:** Inter (or system font stack)

#### Spacing
Create spacing variables:
- `spacing/xs` = 4px
- `spacing/sm` = 8px
- `spacing/md` = 16px
- `spacing/lg` = 24px
- `spacing/xl` = 32px

#### Effects
Create effect styles:
- Shadow/Small: 0 1px 2px rgba(0, 0, 0, 0.1)
- Shadow/Medium: 0 4px 6px rgba(0, 0, 0, 0.2)
- Shadow/Large: 0 10px 15px rgba(0, 0, 0, 0.3)

---

## Step 3: Build Component Library

Create a new page: **"📦 Components"**

### Base Components

#### Button Component
Create variants:
- **Variant:** Primary, Secondary, Danger, Ghost
- **State:** Default, Hover, Active, Disabled
- **Size:** Small, Medium, Large

**Primary Button:**
- Background: #6366F1
- Text: #FFFFFF
- Border radius: 8px
- Padding: 12px 24px
- Height: 44px

#### Card Component
- Background: #1E293B
- Border: 1px solid #475569
- Border radius: 12px
- Padding: 24px
- Use Auto Layout with gap: 16px

#### Input Component
- Background: #0F172A
- Border: 1px solid #475569
- Border radius: 8px
- Height: 44px
- Padding: 12px 16px
- Focus state: 2px solid #6366F1

#### Switch/Toggle Component
- Width: 44px
- Height: 24px
- Active: #10B981
- Inactive: #475569
- Thumb: 20px circle, white

#### Badge Component
- Variants: Success, Danger, Warning, Info, Neutral
- Border radius: 12px
- Padding: 4px 12px
- Height: 24px

---

## Step 4: Create Dashboard Design

Create a new page: **"📊 Dashboard"**

### Layout Structure

1. **Header Section** (1920px width, 80px height)
   - Title: "Trading Dashboard"
   - Subtitle: "Real-time performance metrics and analytics"
   - Live indicator badge (green pulsing dot)

2. **Primary Metrics Grid** (4 columns)
   - 8 metric cards
   - Each card: 280px × 160px
   - Gap: 24px
   - Use Auto Layout

3. **Metric Card Design:**
   ```
   ┌─────────────────────────┐
   │ [Icon] TITLE      [Trend]│
   │                         │
   │      VALUE              │
   │                         │
   │ Description text        │
   └─────────────────────────┘
   ```

4. **Performance Summary Section**
   - 2-column layout (70/30 split)
   - Left: Performance stats grid
   - Right: Recent activity feed

### Design Details

**Metric Card:**
- Background: #1E293B
- Border: 1px solid #475569
- Border radius: 12px
- Padding: 24px
- Title: 12px, uppercase, #94A3B8
- Value: 32px, Bold, #FFFFFF (or color-coded)
- Description: 12px, #64748B

**Status Indicators:**
- Success: Green gradient bar at top
- Danger: Red gradient bar at top
- Use subtle background tint for variant

---

## Step 5: Create Strategy Configuration Design

Create a new page: **"⚙️ Strategy Configuration"**

### Layout Structure

1. **Header** (same as dashboard)
   - Title: "Strategy Configuration"
   - Active strategies counter badge

2. **Bulk Actions Bar**
   - Card container
   - Buttons: Enable All, Disable All, Save All
   - Icons: Play, Pause, Save

3. **Strategy Cards Grid**
   - Entry Strategies section
   - Indicator Strategies section
   - Each strategy in its own card

### Strategy Card Design

```
┌─────────────────────────────────────┐
│ [Active Bar]                         │
│ [Icon] Strategy Name    [Active Badge]│
│                                      │
│ Description text                    │
│                                      │
│ Category • Status          [Toggle]  │
└─────────────────────────────────────┘
```

**Card States:**
- **Active:** Green border, green background tint, green top bar
- **Inactive:** Gray border, default background

**Details:**
- Icon in colored square (emerald for active, gray for inactive)
- Strategy name: 16px, Semibold
- Active badge: Green with checkmark icon
- Description: 14px, #94A3B8
- Toggle switch on the right

---

## Step 6: Create Simulation Results Design

Create a new page: **"📈 Simulation Results"**

### Layout Structure

1. **Header** (same style)
   - Title: "Simulation Results"
   - Total simulations counter

2. **Simulations Grid** (3 columns)
   - Each simulation as a card
   - Click to expand details

3. **Simulation Card Design:**
   ```
   ┌─────────────────────────────┐
   │ Name              [Return %] │
   │ [Date]                     │
   │                             │
   │ [Trades] [Win Rate] [Value] │
   │                             │
   │ ─────────────────────────  │
   │ [History]            [→]    │
   └─────────────────────────────┘
   ```

4. **Details Panel** (when expanded)
   - Full-width card
   - Summary metrics grid
   - Trade history table
   - Export button

### Card Details

- Right border: 1px colored bar (green/red based on return)
- Return badge: Large, color-coded, with trend icon
- Metrics: 3-column grid with icons
- Footer: Border separator, action items

---

## Step 7: Create Additional Pages

### Live Trading Monitor
- Real-time data stream
- Status indicators
- Active positions table
- Performance charts

### Portfolio Overview
- Summary cards (4 columns)
- Holdings table
- Performance chart
- Token icons and symbols

### Backtest Configuration
- Multi-step wizard
- Progress indicator
- Form inputs
- Strategy builder interface

---

## Step 8: Add Interactions & Prototyping

### Set Up Prototypes

1. **Dashboard → Strategy Config**
   - Click "Configure Strategies" button
   - Navigate to Strategy page

2. **Strategy Card Toggle**
   - Click toggle switch
   - Show active/inactive state change
   - Add micro-interaction (scale on click)

3. **Simulation Card → Details**
   - Click simulation card
   - Expand details panel
   - Smooth transition animation

### Animation Settings

- **Transition:** Smart Animate
- **Duration:** 250ms
- **Easing:** Ease In Out

---

## Step 9: Create Responsive Variants

### Breakpoints

1. **Desktop:** 1920px (default)
2. **Tablet:** 1024px
3. **Mobile:** 375px

### Responsive Adjustments

- **Desktop:** 4-column grid
- **Tablet:** 2-column grid
- **Mobile:** 1-column, stacked layout

Use **Constraints** and **Auto Layout** for responsive behavior.

---

## Step 10: Export & Documentation

### Export Assets

1. Icons: SVG format, 1x, 2x, 3x
2. Images: PNG format, @2x, @3x
3. Components: As images for documentation

### Create Design Specs

1. Use **Inspect Mode** in Figma
2. Document spacing, colors, typography
3. Export CSS variables
4. Create component usage guidelines

---

## Tips & Best Practices

1. **Use Auto Layout** everywhere for easy updates
2. **Create Component Variants** for all states
3. **Use Variables** for colors and spacing
4. **Name Layers Clearly** (use forward slash for organization)
5. **Group Related Elements** logically
6. **Use Frames** for page layouts
7. **Set Up Constraints** for responsive design
8. **Add Comments** to explain complex interactions
9. **Use Plugins:**
   - **Stark** for accessibility checking
   - **Content Reel** for placeholder content
   - **Figma to React** for code generation

---

## Component Reference

Refer to these files for implementation details:
- `QUANTBOT_DESIGN_SYSTEM.md` - Complete design system
- `quantbot-dashboard-new.tsx` - Dashboard component
- `strategy-config-new.tsx` - Strategy configuration
- `simulation-results-new.tsx` - Simulation results

---

## Next Steps

1. ✅ Create Figma file
2. ✅ Set up design system
3. ✅ Build component library
4. ✅ Create page designs
5. ✅ Add interactions
6. ✅ Create responsive variants
7. ✅ Export assets
8. ✅ Share with development team

---

## Figma File Structure

```
QuantBot Trading Platform - New Design
├── 🎨 Design System
│   ├── Colors
│   ├── Typography
│   ├── Spacing
│   └── Effects
├── 📦 Components
│   ├── Buttons
│   ├── Cards
│   ├── Inputs
│   ├── Badges
│   └── Tables
├── 📊 Dashboard
├── ⚙️ Strategy Configuration
├── 📈 Simulation Results
├── 🔴 Live Trading
├── 💼 Portfolio
└── ⚡ Backtest Config
```

---

## Color Palette Reference

Copy these hex codes into Figma:

**Backgrounds:**
- Primary: `#0F172A`
- Secondary: `#1E293B`
- Tertiary: `#334155`

**Text:**
- Primary: `#FFFFFF`
- Secondary: `#CBD5E1`
- Muted: `#64748B`

**Accents:**
- Success: `#10B981`
- Danger: `#EF4444`
- Primary: `#6366F1`

---

Happy designing! 🎨

