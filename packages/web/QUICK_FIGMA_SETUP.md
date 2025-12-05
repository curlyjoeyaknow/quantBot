# Quick Setup Guide for New Figma File

## ⚡ Fastest Method: Manual Creation

### Step 1: Create the File (30 seconds)

1. **Open Figma**
   - Desktop: https://www.figma.com/downloads/
   - Web: https://www.figma.com

2. **Create New File**
   - Click **"New Design File"** button (top left)
   - Or press `Cmd/Ctrl + N`
   - Name it: **"QuantBot Trading Platform - New Design"**

3. **Set Frame Size**
   - Default frame should be created
   - Set size to **1920 × 1080** (Desktop)

### Step 2: Set Up Pages (1 minute)

Right-click in the left sidebar → **"Add Page"** and create:

1. 🎨 **Design System**
2. 📦 **Components**
3. 📊 **Dashboard**
4. ⚙️ **Strategy Configuration**
5. 📈 **Simulation Results**
6. 🔴 **Live Trading**
7. 💼 **Portfolio**

### Step 3: Import Design Tokens (2 minutes)

**Option A: Using Plugin (Recommended)**

1. Install **"Design Tokens"** plugin:
   - Go to **Plugins** → **Browse plugins in Community**
   - Search: **"Design Tokens"**
   - Install the plugin

2. Import tokens:
   - Run the plugin (Plugins → Design Tokens)
   - Click **"Import"**
   - Select: `packages/web/figma-design-tokens.json`
   - All colors, spacing, and typography will be created automatically!

**Option B: Manual Setup**

1. Go to **Local Variables** (right sidebar, Variables tab)
2. Create variable groups:
   - `color/background`
   - `color/text`
   - `color/accent`
   - `color/interactive`
   - `spacing`
3. Add variables from `figma-design-tokens.json`

### Step 4: Create Component Library (10 minutes)

Go to **"📦 Components"** page:

1. **Button Component**
   - Create rectangle: 120px × 44px
   - Border radius: 8px
   - Background: #6366F1
   - Add text: "Button"
   - Right-click → **"Create Component"**
   - Create variants: Primary, Secondary, Danger, Ghost
   - Add states: Default, Hover, Active, Disabled

2. **Card Component**
   - Create rectangle: 280px × 160px
   - Border radius: 12px
   - Background: #1E293B
   - Border: 1px #475569
   - Right-click → **"Create Component"**

3. **Input Component**
   - Create rectangle: 300px × 44px
   - Border radius: 8px
   - Background: #0F172A
   - Border: 1px #475569
   - Right-click → **"Create Component"**

### Step 5: Build Dashboard (15 minutes)

Go to **"📊 Dashboard"** page:

1. **Create Main Frame**
   - Size: 1920 × 1080
   - Background: #0F172A

2. **Add Header**
   - Text: "Trading Dashboard" (36px, Bold, White)
   - Subtitle: "Real-time performance metrics" (16px, #94A3B8)
   - Live indicator badge (green pulsing dot)

3. **Create Metrics Grid**
   - Use Auto Layout (Horizontal)
   - Gap: 24px
   - Add 8 Metric Card instances
   - Each card: 280px × 160px

4. **Add Performance Section**
   - Two-column layout
   - Left: Performance stats
   - Right: Recent activity feed

### Step 6: Reference Materials

Use these files as reference:

- **Component Specs:** `FIGMA_COMPONENT_SPECS.md` (pixel-perfect specs)
- **Design System:** `QUANTBOT_DESIGN_SYSTEM.md` (complete system)
- **React Components:** 
  - `components/quantbot-dashboard-new.tsx`
  - `components/strategy-config-new.tsx`
  - `components/simulation-results-new.tsx`

---

## 🎨 Design Token Reference

### Colors (Quick Copy)

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

### Typography

**Font:** Inter (or system font stack)

**Sizes:**
- Display: 48px
- H1: 36px
- H2: 30px
- H3: 24px
- Body: 16px
- Small: 14px
- Caption: 12px

### Spacing

Base unit: **4px**
- xs: 4px
- sm: 8px
- md: 16px
- lg: 24px
- xl: 32px

---

## ✅ Checklist

- [ ] Figma file created
- [ ] Pages set up (7 pages)
- [ ] Design tokens imported
- [ ] Component library started
- [ ] Dashboard layout created
- [ ] Color styles created
- [ ] Text styles created
- [ ] Components use Auto Layout
- [ ] Variants created for states

---

## 🚀 Next Steps

1. Build remaining pages (Strategy Config, Simulations, etc.)
2. Add interactions and prototypes
3. Create responsive variants
4. Export assets
5. Share with development team

---

## 📚 Full Documentation

- **Complete Guide:** `CREATE_FIGMA_FILE.md`
- **Design System:** `QUANTBOT_DESIGN_SYSTEM.md`
- **Component Specs:** `FIGMA_COMPONENT_SPECS.md`
- **Summary:** `NEW_FIGMA_DESIGNS_SUMMARY.md`

---

**Time Estimate:** ~30 minutes for basic setup, 2-3 hours for complete design system

**Difficulty:** Beginner-friendly with step-by-step guides

