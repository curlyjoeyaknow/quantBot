# How to Create the New Figma File

Since I cannot directly create a Figma file through the API, here's the step-by-step process to create it manually with all the design tokens ready to import.

## Quick Start - 3 Methods

### Method 1: Manual Creation (Recommended)

1. **Open Figma** (Desktop app or web)
2. Click **"New Design File"** or press `Cmd/Ctrl + N`
3. Name it: **"QuantBot Trading Platform - New Design"**
4. Follow the setup steps below

### Method 2: Use Figma Plugin

1. Install **"Design Tokens"** plugin from Figma Community
2. Import the `figma-design-tokens.json` file
3. All colors and tokens will be automatically created

### Method 3: Duplicate Template

1. I can help you create a template file that you can duplicate
2. Or use the browser automation to guide you through creation

---

## Step-by-Step Manual Setup

### Step 1: Create the File

1. Open Figma
2. Click **"New Design File"**
3. Name: `QuantBot Trading Platform - New Design`
4. Set frame size: **1920 × 1080** (Desktop)

### Step 2: Set Up Pages

Create these pages in order:

1. **🎨 Design System**
2. **📦 Components**
3. **📊 Dashboard**
4. **⚙️ Strategy Configuration**
5. **📈 Simulation Results**
6. **🔴 Live Trading**
7. **💼 Portfolio**

### Step 3: Import Design Tokens

#### Option A: Using Figma Variables (Recommended)

1. Go to **Local Variables** (right sidebar, Variables tab)
2. Click **"+"** to create variable groups
3. Create these groups:
   - `color/background`
   - `color/text`
   - `color/accent`
   - `color/interactive`
   - `spacing`
   - `typography`

4. For each color in `figma-design-tokens.json`:
   - Click **"+"** in the group
   - Set name (e.g., `primary`)
   - Set value to the hex code
   - Set mode to **"Color"**

#### Option B: Using Styles

1. Select any frame
2. Go to **Fill** in right sidebar
3. Click **"+"** next to "Color styles"
4. Create styles for each color
5. Name them: `Background/Primary`, `Text/Primary`, etc.

### Step 4: Create Text Styles

1. Create a text layer
2. Set font: **Inter** (or system font)
3. For each text style in the design system:
   - Set size, weight, line height
   - Click **"+"** next to "Text styles"
   - Name: `Display`, `H1`, `H2`, `Body`, etc.

### Step 5: Set Up Component Library

1. Go to **"📦 Components"** page
2. Create base components:
   - Button (with variants)
   - Card
   - Input
   - Badge
   - Switch/Toggle

3. Use **Auto Layout** for all components
4. Create **Component Variants** for states:
   - Default, Hover, Active, Disabled

### Step 6: Build Page Layouts

1. Go to **"📊 Dashboard"** page
2. Create frame: **1920 × 1080**
3. Follow the component specs in `FIGMA_COMPONENT_SPECS.md`
4. Use the React components as visual reference

---

## Automated Setup Script

I can create a script that generates Figma-compatible JSON that can be imported. Would you like me to:

1. **Create a Figma plugin** that sets up everything automatically?
2. **Generate a Figma file template** in JSON format?
3. **Use browser automation** to guide you through creating the file step-by-step?

---

## Import Design Tokens

The `figma-design-tokens.json` file contains all design tokens in a format that can be imported into Figma using:

1. **Figma Tokens Plugin** (Community plugin)
2. **Style Dictionary** (export to Figma)
3. **Manual import** (copy values)

---

## Next Steps

1. ✅ Create the file manually (or I can guide you via browser)
2. ✅ Import design tokens
3. ✅ Set up component library
4. ✅ Build page designs
5. ✅ Add interactions

Would you like me to:
- **Navigate to Figma in the browser** and guide you through creation?
- **Create a Figma plugin** to automate setup?
- **Generate a complete Figma file JSON** that can be imported?

