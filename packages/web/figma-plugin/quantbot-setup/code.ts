/**
 * QuantBot Figma Replica Generator Plugin
 * ========================================
 * Creates Figma designs based on the existing figma-replica React components:
 * - Sign In page (440x956)
 * - Register page
 * - Forgot Password page
 * - Setup Overview (Step 1/4)
 * - Add Product (Step 2/4)
 * - Shipping & Pricing (Step 3/4)
 * - Review Summary (Step 4/4)
 * 
 * This plugin replicates the UI components as Figma frames with proper styling.
 */

// Component specifications based on the React figma-replica components
const componentSpecs = {
  signIn: {
    name: 'Sign In',
    width: 440,
    height: 956,
    backgroundColor: '#0a3a32', // Dark teal background from sign-in.tsx
    elements: [
      // Header with logo and account icon
      { type: 'frame', name: 'Header', x: 0, y: 0, width: 440, height: 100, bg: '#0a3a32' },
      
      // Title
      { type: 'text', content: 'Sign In', fontSize: 32, fontWeight: 700, x: 40, y: 200, color: '#FFFFFF' },
      
      // Email input
      { type: 'input', label: 'Email', x: 40, y: 280, width: 360, height: 56, placeholder: 'Enter your email' },
      
      // Password input
      { type: 'input', label: 'Password', x: 40, y: 360, width: 360, height: 56, placeholder: 'Enter your password', isPassword: true },
      
      // Forgot password link
      { type: 'link', content: 'Forgot password?', x: 40, y: 440, color: '#2481CC' },
      
      // Sign In button (dark, 35% width)
      { type: 'button', content: 'SIGN IN', x: 40, y: 520, width: 154, height: 47, primary: true, bg: '#0a3a32', textColor: '#FFFFFF' },
      
      // Register button (light, 35% width)
      { type: 'button', content: 'REGISTER', x: 214, y: 520, width: 154, height: 47, primary: false, bg: '#F5F5F5', textColor: '#0a3a32' },
      
      // Create Account link
      { type: 'link', content: 'Create Account', x: 40, y: 600, color: '#000000' },
    ],
  },
  register: {
    name: 'Register',
    width: 440,
    height: 956,
    backgroundColor: '#FFFFFF',
    elements: [
      { type: 'text', content: 'Create Account', fontSize: 32, fontWeight: 700, x: 40, y: 100, color: '#000000' },
      { type: 'input', label: 'Email', x: 40, y: 200, width: 360, height: 56 },
      { type: 'input', label: 'Password', x: 40, y: 280, width: 360, height: 56, isPassword: true },
      { type: 'input', label: 'Confirm Password', x: 40, y: 360, width: 360, height: 56, isPassword: true },
      { type: 'button', content: 'REGISTER', x: 40, y: 460, width: 360, height: 56, primary: true, bg: '#2481CC', textColor: '#FFFFFF' },
      { type: 'link', content: 'Already have an account? Sign In', x: 40, y: 540, color: '#2481CC' },
    ],
  },
  forgotPassword: {
    name: 'Forgot Password',
    width: 440,
    height: 956,
    backgroundColor: '#FFFFFF',
    elements: [
      { type: 'text', content: 'Forgot Password?', fontSize: 32, fontWeight: 700, x: 40, y: 100, color: '#000000' },
      { type: 'text', content: 'Enter your email to reset your password', fontSize: 16, fontWeight: 400, x: 40, y: 160, color: '#666666' },
      { type: 'input', label: 'Email', x: 40, y: 240, width: 360, height: 56 },
      { type: 'button', content: 'SEND RESET LINK', x: 40, y: 320, width: 360, height: 56, primary: true, bg: '#2481CC', textColor: '#FFFFFF' },
      { type: 'link', content: 'Back to Sign In', x: 40, y: 400, color: '#2481CC' },
    ],
  },
  setupOverview: {
    name: 'Setup Overview',
    width: 1200,
    height: 800,
    backgroundColor: '#FFFFFF',
    elements: [
      { type: 'text', content: 'Setup Overview', fontSize: 28, fontWeight: 700, x: 40, y: 40, color: '#000000' },
      { type: 'text', content: 'Step 1 of 4', fontSize: 16, fontWeight: 400, x: 40, y: 100, color: '#666666' },
      { type: 'progress', steps: 4, current: 1, x: 40, y: 140, width: 1120, height: 8 },
      { type: 'input', label: 'Shop Name', x: 40, y: 200, width: 500, height: 56 },
      { type: 'button', content: '← BACK', x: 40, y: 300, width: 120, height: 44, primary: false },
      { type: 'button', content: 'CONTINUE →', x: 960, y: 300, width: 200, height: 44, primary: true, bg: '#0a3a32', textColor: '#FFFFFF' },
    ],
  },
  addProduct: {
    name: 'Add Product',
    width: 1200,
    height: 800,
    backgroundColor: '#FFFFFF',
    elements: [
      { type: 'text', content: 'Add Product', fontSize: 28, fontWeight: 700, x: 40, y: 40, color: '#000000' },
      { type: 'text', content: 'Step 2 of 4', fontSize: 16, fontWeight: 400, x: 40, y: 100, color: '#666666' },
      { type: 'progress', steps: 4, current: 2, x: 40, y: 140, width: 1120, height: 8 },
      { type: 'input', label: 'Product Name', x: 40, y: 200, width: 500, height: 56 },
      { type: 'input', label: 'Product Price', x: 40, y: 280, width: 500, height: 56 },
      { type: 'frame', name: 'Image Upload', x: 600, y: 200, width: 300, height: 300, bg: '#F5F5F5', border: true },
      { type: 'button', content: 'ADD ANOTHER', x: 40, y: 400, width: 200, height: 44, primary: true },
    ],
  },
  shippingPricing: {
    name: 'Shipping & Pricing',
    width: 1200,
    height: 800,
    backgroundColor: '#FFFFFF',
    elements: [
      { type: 'text', content: 'Shipping & Pricing', fontSize: 28, fontWeight: 700, x: 40, y: 40, color: '#000000' },
      { type: 'text', content: 'Step 3 of 4', fontSize: 16, fontWeight: 400, x: 40, y: 100, color: '#666666' },
      { type: 'progress', steps: 4, current: 3, x: 40, y: 140, width: 1120, height: 8 },
      { type: 'input', label: 'Shipping Type', x: 40, y: 200, width: 500, height: 56 },
      { type: 'input', label: 'Delivery Days', x: 40, y: 280, width: 500, height: 56 },
    ],
  },
  review: {
    name: 'Review Summary',
    width: 1200,
    height: 800,
    backgroundColor: '#FFFFFF',
    elements: [
      { type: 'text', content: 'Review Summary', fontSize: 28, fontWeight: 700, x: 40, y: 40, color: '#000000' },
      { type: 'text', content: 'Step 4 of 4', fontSize: 16, fontWeight: 400, x: 40, y: 100, color: '#666666' },
      { type: 'progress', steps: 4, current: 4, x: 40, y: 140, width: 1120, height: 8 },
      { type: 'text', content: 'Shop Name:', fontSize: 16, fontWeight: 600, x: 40, y: 200, color: '#000000' },
      { type: 'text', content: 'Products:', fontSize: 16, fontWeight: 600, x: 40, y: 280, color: '#000000' },
      { type: 'button', content: 'BACK TO PRODUCTS', x: 40, y: 500, width: 200, height: 44, primary: false },
      { type: 'button', content: 'LAUNCH SHOP', x: 960, y: 500, width: 200, height: 44, primary: true, bg: '#0a3a32', textColor: '#FFFFFF' },
    ],
  },
};

// Helper function to convert hex to RGB
function hexToRgb(hex: string): RGB {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16) / 255,
        g: parseInt(result[2], 16) / 255,
        b: parseInt(result[3], 16) / 255,
      }
    : { r: 0, g: 0, b: 0 };
}

// Create a frame for a component
async function createComponentFrame(spec: any, page: PageNode) {
  // Load fonts first
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });
  await figma.loadFontAsync({ family: 'Albert Sans', style: 'Black' }); // For buttons

  const frame = figma.createFrame();
  frame.name = spec.name;
  frame.resize(spec.width, spec.height);
  frame.fills = [{ type: 'SOLID', color: hexToRgb(spec.backgroundColor) }];
  frame.x = 0;
  frame.y = 0;

  // Create elements
  for (const element of spec.elements) {
    if (element.type === 'text') {
      const fontWeight = element.fontWeight || 400;
      let fontFamily = 'Inter';
      let fontStyle = 'Regular';
      if (fontWeight >= 700) fontStyle = 'Bold';
      else if (fontWeight >= 600) fontStyle = 'Semi Bold';
      else if (fontWeight >= 500) fontStyle = 'Medium';
      
      try {
        await figma.loadFontAsync({ family: fontFamily, style: fontStyle });
        const text = figma.createText();
        text.characters = element.content;
        text.fontSize = element.fontSize;
        text.fontName = { family: fontFamily, style: fontStyle };
        text.fills = [{ type: 'SOLID', color: hexToRgb(element.color || '#000000') }];
        text.x = element.x;
        text.y = element.y;
        frame.appendChild(text);
      } catch (e) {
        // Fallback if font not available
        console.warn(`Font ${fontFamily} ${fontStyle} not available, using Inter`);
      }
    } else if (element.type === 'input') {
      const inputFrame = figma.createFrame();
      inputFrame.name = element.label || 'Input';
      inputFrame.resize(element.width, element.height);
      inputFrame.fills = [{ type: 'SOLID', color: hexToRgb('#FFFFFF') }];
      inputFrame.strokes = [{ type: 'SOLID', color: hexToRgb('#d9d9d9') }];
      inputFrame.strokeWeight = 2;
      inputFrame.cornerRadius = 8;
      inputFrame.x = element.x;
      inputFrame.y = element.y;
      
      // Add placeholder text
      if (element.placeholder) {
        try {
          await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
          const placeholder = figma.createText();
          placeholder.characters = element.placeholder;
          placeholder.fontSize = 16;
          placeholder.fontName = { family: 'Inter', style: 'Regular' };
          placeholder.fills = [{ type: 'SOLID', color: hexToRgb('#999999') }];
          placeholder.x = 16;
          placeholder.y = (element.height - 16) / 2;
          inputFrame.appendChild(placeholder);
        } catch (e) {
          console.warn('Could not create placeholder text');
        }
      }
      
      frame.appendChild(inputFrame);
    } else if (element.type === 'button') {
      const button = figma.createFrame();
      button.name = element.content;
      button.resize(element.width, element.height);
      const bgColor = element.bg || (element.primary ? '#2481CC' : '#FFFFFF');
      const textColor = element.textColor || (element.primary ? '#FFFFFF' : '#2481CC');
      
      button.fills = [{ type: 'SOLID', color: hexToRgb(bgColor) }];
      if (!element.primary) {
        button.strokes = [{ type: 'SOLID', color: hexToRgb('#2481CC') }];
        button.strokeWeight = 1;
      }
      button.cornerRadius = 8;
      button.x = element.x;
      button.y = element.y;
      
      // Button text - try Albert Sans Black first (as in sign-in.tsx), fallback to Inter
      try {
        await figma.loadFontAsync({ family: 'Albert Sans', style: 'Black' });
        const buttonText = figma.createText();
        buttonText.characters = element.content;
        buttonText.fontSize = 20;
        buttonText.fontName = { family: 'Albert Sans', style: 'Black' };
        buttonText.fills = [{ type: 'SOLID', color: hexToRgb(textColor) }];
        buttonText.x = (element.width - buttonText.width) / 2;
        buttonText.y = (element.height - buttonText.height) / 2;
        button.appendChild(buttonText);
      } catch (e) {
        // Fallback to Inter Bold
        await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });
        const buttonText = figma.createText();
        buttonText.characters = element.content;
        buttonText.fontSize = 16;
        buttonText.fontName = { family: 'Inter', style: 'Bold' };
        buttonText.fills = [{ type: 'SOLID', color: hexToRgb(textColor) }];
        buttonText.x = (element.width - buttonText.width) / 2;
        buttonText.y = (element.height - buttonText.height) / 2;
        button.appendChild(buttonText);
      }
      
      frame.appendChild(button);
    } else if (element.type === 'link') {
      try {
        await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
        const link = figma.createText();
        link.characters = element.content;
        link.fontSize = 16;
        link.fontName = { family: 'Inter', style: 'Regular' };
        link.fills = [{ type: 'SOLID', color: hexToRgb(element.color || '#2481CC') }];
        link.x = element.x;
        link.y = element.y;
        frame.appendChild(link);
      } catch (e) {
        console.warn('Could not create link text');
      }
    } else if (element.type === 'progress') {
      const progressFrame = figma.createFrame();
      progressFrame.name = 'Progress';
      progressFrame.resize(element.width, element.height || 8);
      progressFrame.fills = [{ type: 'SOLID', color: hexToRgb('#E0E0E0') }];
      progressFrame.cornerRadius = 4;
      progressFrame.x = element.x;
      progressFrame.y = element.y;
      
      // Active step indicator
      const activeWidth = (element.width / element.steps) * element.current;
      const activeBar = figma.createFrame();
      activeBar.resize(activeWidth, element.height || 8);
      activeBar.fills = [{ type: 'SOLID', color: hexToRgb('#0a3a32') }];
      activeBar.cornerRadius = 4;
      progressFrame.appendChild(activeBar);
      
      frame.appendChild(progressFrame);
    } else if (element.type === 'frame') {
      const subFrame = figma.createFrame();
      subFrame.name = element.name || 'Frame';
      subFrame.resize(element.width, element.height);
      subFrame.fills = [{ type: 'SOLID', color: hexToRgb(element.bg || '#FFFFFF') }];
      if (element.border) {
        subFrame.strokes = [{ type: 'SOLID', color: hexToRgb('#E0E0E0') }];
        subFrame.strokeWeight = 1;
      }
      subFrame.x = element.x;
      subFrame.y = element.y;
      frame.appendChild(subFrame);
    }
  }

  page.appendChild(frame);
  return frame;
}

// Main function to create all replicas
async function createFigmaReplicas() {
  try {
    figma.notify('🎨 Creating Figma replicas...', { timeout: 2000 });

    // Create or find the page
    let page = figma.currentPage;
    const pageName = '📱 Figma Replicas';
    
    // Check if page already exists
    const existingPage = figma.root.children.find((p) => p.name === pageName);
    if (existingPage) {
      page = existingPage as PageNode;
      figma.currentPage = page;
    } else {
      page = figma.createPage();
      page.name = pageName;
      figma.currentPage = page;
    }

    const spacing = 50;
    let currentX = 50;

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

    figma.notify('✅ Figma replicas created successfully!', { timeout: 3000 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    figma.notify(`❌ Error: ${errorMessage}`, { timeout: 5000 });
    console.error(error);
  }
}

// Handle messages from UI
figma.ui.onmessage = (msg) => {
  if (msg.type === 'create-replicas') {
    createFigmaReplicas();
  } else if (msg.type === 'cancel') {
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
      Creates Figma frames replicating your figma-replica React components.
    </div>
    <div class="section">
      <div class="section-title">Components to Create</div>
      <ul class="feature-list">
        <li>Sign In (440×956)</li>
        <li>Register</li>
        <li>Forgot Password</li>
        <li>Setup Overview (Step 1/4)</li>
        <li>Add Product (Step 2/4)</li>
        <li>Shipping & Pricing (Step 3/4)</li>
        <li>Review Summary (Step 4/4)</li>
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
