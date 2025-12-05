# Automate Frame to Component Conversion via Figma Plugin

Since the Figma API is read-only, here's how to run an automated script inside Figma:

## Method 1: Quick Console Script (Recommended - 30 seconds)

1. **Open Figma** in your regular browser:
   - https://www.figma.com/design/dfD3nN79LuyG7Fjs6BnDxZ/Shopify

2. **Create a quick plugin**:
   - Right-click anywhere in Figma
   - Go to: **Plugins** → **Development** → **New Plugin...**
   - Choose "Empty" template
   - Name it "Frame to Component Converter"

3. **Paste the conversion code**:
   - The plugin editor will open
   - Replace everything in `code.ts` with the content from `figma-convert-frames.js`
   - Click **Save**

4. **Run the plugin**:
   - Right-click in Figma
   - Go to: **Plugins** → **Development** → **Frame to Component Converter**
   - The script will automatically convert all 4 frames

5. **Publish to Figma Code Connect**:
   ```bash
   cd /home/memez/quantBot/web
   export FIGMA_ACCESS_TOKEN="figd_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
   npx figma connect publish
   ```

## Method 2: Manual (2-3 minutes)

Just use keyboard shortcut on each frame:
1. Click frame → `Ctrl+Alt+K` (or `Cmd+Option+K` on Mac)
2. Repeat for all 7 frames
3. Done

## Why can't the API do this?

- **Figma REST API**: Read-only for design content
- **Figma MCP**: Also read-only
- **Figma Plugin API**: Can modify designs, but runs inside Figma (not externally)

The plugin script above uses the Plugin API to automate the conversion while you're in Figma.

