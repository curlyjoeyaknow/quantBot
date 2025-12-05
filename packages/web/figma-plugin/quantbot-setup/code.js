"use strict";
/**
 * QuantBot Figma Replica Generator Plugin
 * ========================================
 * Creates Figma designs based on the existing React components:
 * - Sign In page
 * - Register page
 * - Forgot Password page
 * - Setup Overview
 * - Add Product
 * - Shipping & Pricing
 * - Review Summary
 *
 * This plugin replicates the UI components as Figma frames.
 */
// Component specifications based on the React components
const componentSpecs = {
    signIn: {
        name: 'Sign In',
        width: 440,
        height: 956,
        backgroundColor: '#FFFFFF',
        elements: [
            { type: 'text', content: 'Sign In', fontSize: 32, fontWeight: 700, x: 40, y: 100 },
            { type: 'input', label: 'Email', x: 40, y: 200, width: 360, height: 56 },
            { type: 'input', label: 'Password', x: 40, y: 280, width: 360, height: 56, isPassword: true },
            { type: 'link', content: 'Forgot password?', x: 40, y: 360, color: '#2481CC' },
            { type: 'button', content: 'SIGN IN', x: 40, y: 440, width: 360, height: 56, primary: true },
            { type: 'button', content: 'REGISTER', x: 40, y: 520, width: 360, height: 56, primary: false },
            { type: 'link', content: 'Create Account', x: 40, y: 600, color: '#2481CC' },
        ],
    },
    register: {
        name: 'Register',
        width: 440,
        height: 956,
        backgroundColor: '#FFFFFF',
        elements: [
            { type: 'text', content: 'Create Account', fontSize: 32, fontWeight: 700, x: 40, y: 100 },
            { type: 'input', label: 'Email', x: 40, y: 200, width: 360, height: 56 },
            { type: 'input', label: 'Password', x: 40, y: 280, width: 360, height: 56, isPassword: true },
            { type: 'input', label: 'Confirm Password', x: 40, y: 360, width: 360, height: 56, isPassword: true },
            { type: 'button', content: 'REGISTER', x: 40, y: 460, width: 360, height: 56, primary: true },
            { type: 'link', content: 'Already have an account? Sign In', x: 40, y: 540, color: '#2481CC' },
        ],
    },
    forgotPassword: {
        name: 'Forgot Password',
        width: 440,
        height: 956,
        backgroundColor: '#FFFFFF',
        elements: [
            { type: 'text', content: 'Forgot Password?', fontSize: 32, fontWeight: 700, x: 40, y: 100 },
            { type: 'text', content: 'Enter your email to reset your password', fontSize: 16, fontWeight: 400, x: 40, y: 160, color: '#666666' },
            { type: 'input', label: 'Email', x: 40, y: 240, width: 360, height: 56 },
            { type: 'button', content: 'SEND RESET LINK', x: 40, y: 320, width: 360, height: 56, primary: true },
            { type: 'link', content: 'Back to Sign In', x: 40, y: 400, color: '#2481CC' },
        ],
    },
    setupOverview: {
        name: 'Setup Overview',
        width: 1200,
        height: 800,
        backgroundColor: '#FFFFFF',
        elements: [
            { type: 'text', content: 'Setup Overview', fontSize: 28, fontWeight: 700, x: 40, y: 40 },
            { type: 'text', content: 'Step 1 of 4', fontSize: 16, fontWeight: 400, x: 40, y: 100, color: '#666666' },
            { type: 'progress', steps: 4, current: 1, x: 40, y: 140, width: 1120 },
        ],
    },
    addProduct: {
        name: 'Add Product',
        width: 1200,
        height: 800,
        backgroundColor: '#FFFFFF',
        elements: [
            { type: 'text', content: 'Add Product', fontSize: 28, fontWeight: 700, x: 40, y: 40 },
            { type: 'text', content: 'Step 2 of 4', fontSize: 16, fontWeight: 400, x: 40, y: 100, color: '#666666' },
            { type: 'progress', steps: 4, current: 2, x: 40, y: 140, width: 1120 },
            { type: 'input', label: 'Product Name', x: 40, y: 200, width: 500, height: 56 },
            { type: 'input', label: 'Description', x: 40, y: 280, width: 500, height: 120, multiline: true },
        ],
    },
    shippingPricing: {
        name: 'Shipping & Pricing',
        width: 1200,
        height: 800,
        backgroundColor: '#FFFFFF',
        elements: [
            { type: 'text', content: 'Shipping & Pricing', fontSize: 28, fontWeight: 700, x: 40, y: 40 },
            { type: 'text', content: 'Step 3 of 4', fontSize: 16, fontWeight: 400, x: 40, y: 100, color: '#666666' },
            { type: 'progress', steps: 4, current: 3, x: 40, y: 140, width: 1120 },
        ],
    },
    review: {
        name: 'Review Summary',
        width: 1200,
        height: 800,
        backgroundColor: '#FFFFFF',
        elements: [
            { type: 'text', content: 'Review Summary', fontSize: 28, fontWeight: 700, x: 40, y: 40 },
            { type: 'text', content: 'Step 4 of 4', fontSize: 16, fontWeight: 400, x: 40, y: 100, color: '#666666' },
            { type: 'progress', steps: 4, current: 4, x: 40, y: 140, width: 1120 },
        ],
    },
};
// Create a frame for a component
async function createComponentFrame(spec, page) {
    // Load fonts first
    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
    await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
    await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });
    await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });
    const frame = figma.createFrame();
    frame.name = spec.name;
    frame.resize(spec.width, spec.height);
    frame.fills = [{ type: 'SOLID', color: hexToRgb(spec.backgroundColor) }];
    frame.x = 0;
    frame.y = 0;
    // Create elements - use for...of instead of forEach for async
    for (const element of spec.elements) {
        if (element.type === 'text') {
            const fontWeight = element.fontWeight || 400;
            let fontStyle = 'Regular';
            if (fontWeight >= 700)
                fontStyle = 'Bold';
            else if (fontWeight >= 600)
                fontStyle = 'Semi Bold';
            else if (fontWeight >= 500)
                fontStyle = 'Medium';
            const text = figma.createText();
            text.characters = element.content;
            text.fontSize = element.fontSize;
            text.fontName = { family: 'Inter', style: fontStyle };
            text.fills = [{ type: 'SOLID', color: hexToRgb(element.color || '#000000') }];
            text.x = element.x;
            text.y = element.y;
            frame.appendChild(text);
        }
        else if (element.type === 'input') {
            const inputFrame = figma.createFrame();
            inputFrame.name = element.label;
            inputFrame.resize(element.width, element.height);
            inputFrame.fills = [{ type: 'SOLID', color: hexToRgb('#FFFFFF') }];
            inputFrame.strokes = [{ type: 'SOLID', color: hexToRgb('#E0E0E0') }];
            inputFrame.strokeWeight = 1;
            inputFrame.cornerRadius = 8;
            inputFrame.x = element.x;
            inputFrame.y = element.y;
            // Add label
            const label = figma.createText();
            label.characters = element.label;
            label.fontSize = 14;
            label.fontName = { family: 'Inter', style: 'Regular' };
            label.fills = [{ type: 'SOLID', color: hexToRgb('#666666') }];
            label.x = 12;
            label.y = 12;
            inputFrame.appendChild(label);
            frame.appendChild(inputFrame);
        }
        else if (element.type === 'button') {
            const button = figma.createFrame();
            button.name = element.content;
            button.resize(element.width, element.height);
            button.fills = [{
                    type: 'SOLID',
                    color: hexToRgb(element.primary ? '#2481CC' : '#FFFFFF')
                }];
            if (!element.primary) {
                button.strokes = [{ type: 'SOLID', color: hexToRgb('#2481CC') }];
                button.strokeWeight = 1;
            }
            button.cornerRadius = 8;
            button.x = element.x;
            button.y = element.y;
            const buttonText = figma.createText();
            buttonText.characters = element.content;
            buttonText.fontSize = 16;
            buttonText.fontName = { family: 'Inter', style: 'Semi Bold' };
            buttonText.fills = [{
                    type: 'SOLID',
                    color: hexToRgb(element.primary ? '#FFFFFF' : '#2481CC')
                }];
            buttonText.x = element.width / 2 - 50; // Approximate centering
            buttonText.y = element.height / 2 - 10;
            button.appendChild(buttonText);
            frame.appendChild(button);
        }
        else if (element.type === 'link') {
            const link = figma.createText();
            link.characters = element.content;
            link.fontSize = 14;
            link.fontName = { family: 'Inter', style: 'Regular' };
            link.fills = [{ type: 'SOLID', color: hexToRgb(element.color || '#2481CC') }];
            link.x = element.x;
            link.y = element.y;
            frame.appendChild(link);
        }
        else if (element.type === 'progress') {
            const progressFrame = figma.createFrame();
            progressFrame.name = 'Progress';
            progressFrame.resize(element.width, 8);
            progressFrame.fills = [{ type: 'SOLID', color: hexToRgb('#E0E0E0') }];
            progressFrame.cornerRadius = 4;
            progressFrame.x = element.x;
            progressFrame.y = element.y;
            // Active step indicator
            const activeWidth = (element.width / element.steps) * element.current;
            const activeBar = figma.createFrame();
            activeBar.resize(activeWidth, 8);
            activeBar.fills = [{ type: 'SOLID', color: hexToRgb('#2481CC') }];
            activeBar.cornerRadius = 4;
            progressFrame.appendChild(activeBar);
            frame.appendChild(progressFrame);
        }
    }
    page.appendChild(frame);
    return frame;
}
// Helper function to convert hex to RGB
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
        ? {
            r: parseInt(result[1], 16) / 255,
            g: parseInt(result[2], 16) / 255,
            b: parseInt(result[3], 16) / 255,
        }
        : { r: 0, g: 0, b: 0 };
}
// Main function to create all replicas
async function createFigmaReplicas() {
    try {
        figma.notify('🎨 Creating Figma replicas...', { timeout: 2000 });
        // Load fonts
        await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
        await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
        await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });
        await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });
        // Create or find the page
        let page = figma.currentPage;
        const pageName = '📱 Figma Replicas';
        // Check if page already exists
        const existingPage = figma.root.children.find((p) => p.name === pageName);
        if (existingPage) {
            page = existingPage;
            figma.currentPage = page;
        }
        else {
            page = figma.createPage();
            page.name = pageName;
            figma.currentPage = page;
        }
        // Clear existing frames (optional - comment out if you want to keep existing)
        // page.children.forEach(child => child.remove());
        let currentX = 0;
        const spacing = 50;
        // Create all component replicas
        const components = [
            componentSpecs.signIn,
            componentSpecs.register,
            componentSpecs.forgotPassword,
            componentSpecs.setupOverview,
            componentSpecs.addProduct,
            componentSpecs.shippingPricing,
            componentSpecs.review,
        ];
        for (const spec of components) {
            const frame = await createComponentFrame(spec, page);
            frame.x = currentX;
            currentX += spec.width + spacing;
        }
        // Center frames on page
        const totalWidth = components.reduce((sum, spec) => sum + spec.width + spacing, -spacing);
        const startX = (1920 - totalWidth) / 2;
        let x = startX;
        page.children.forEach((child) => {
            if (child.type === 'FRAME') {
                child.x = x;
                x += child.width + spacing;
            }
        });
        figma.notify('✅ Figma replicas created successfully!', { timeout: 3000 });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        figma.notify(`❌ Error: ${errorMessage}`, { timeout: 5000 });
        console.error(error);
    }
}
// Handle messages from UI
figma.ui.onmessage = (msg) => {
    if (msg.type === 'create-replicas') {
        createFigmaReplicas();
    }
    else if (msg.type === 'cancel') {
        figma.closePlugin();
    }
};
// Show UI
figma.showUI(`
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>QuantBot Figma Replicas</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background: #0F172A; color: #FFFFFF; padding: 24px; line-height: 1.5;
      }
      h1 { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
      .subtitle { font-size: 14px; color: #94A3B8; margin-bottom: 24px; }
      .section { margin-bottom: 24px; }
      .section-title {
        font-size: 14px; font-weight: 600; color: #CBD5E1; margin-bottom: 12px;
        text-transform: uppercase; letter-spacing: 0.5px;
      }
      .feature-list { list-style: none; margin-bottom: 16px; }
      .feature-list li {
        font-size: 13px; color: #94A3B8; padding: 6px 0; padding-left: 24px;
        position: relative;
      }
      .feature-list li:before {
        content: "✓"; position: absolute; left: 0; color: #10B981; font-weight: bold;
      }
      .button {
        width: 100%; padding: 12px 24px; border: none; border-radius: 8px;
        font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s;
        margin-bottom: 12px;
      }
      .button-primary {
        background: #6366F1; color: #FFFFFF;
      }
      .button-primary:hover { background: #818CF8; transform: translateY(-1px); }
      .button-primary:active { background: #4F46E5; transform: translateY(0); }
      .button-secondary {
        background: transparent; color: #94A3B8; border: 1px solid #475569;
      }
      .button-secondary:hover { background: #1E293B; color: #FFFFFF; }
      .status {
        padding: 12px; border-radius: 8px; margin-bottom: 16px; font-size: 13px;
        background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3);
        color: #60A5FA;
      }
    </style>
  </head>
  <body>
    <h1>QuantBot Figma Replicas</h1>
    <p class="subtitle">Generate Figma designs from React components</p>
    <div class="status">
      <strong>What this does:</strong><br>
      Creates Figma frames replicating your React components.
    </div>
    <div class="section">
      <div class="section-title">Components to Create</div>
      <ul class="feature-list">
        <li>Sign In</li>
        <li>Register</li>
        <li>Forgot Password</li>
        <li>Setup Overview</li>
        <li>Add Product</li>
        <li>Shipping & Pricing</li>
        <li>Review Summary</li>
      </ul>
    </div>
    <button class="button button-primary" id="create-btn">🎨 Create Figma Replicas</button>
    <button class="button button-secondary" id="cancel-btn">Cancel</button>
    <script>
      document.getElementById('create-btn').addEventListener('click', () => {
        document.getElementById('create-btn').disabled = true;
        document.getElementById('create-btn').textContent = 'Creating...';
        parent.postMessage({ pluginMessage: { type: 'create-replicas' } }, '*');
      });
      document.getElementById('cancel-btn').addEventListener('click', () => {
        parent.postMessage({ pluginMessage: { type: 'cancel' } }, '*');
      });
    </script>
  </body>
  </html>
`, { width: 400, height: 500 });
