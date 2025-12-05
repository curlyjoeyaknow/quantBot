// Simple Figma plugin to display component code

figma.showUI(__html__, { width: 600, height: 800 });

figma.ui.onmessage = msg => {
  if (msg.type === 'get-component-code') {
    const selection = figma.currentPage.selection[0];
    
    if (selection && selection.type === 'COMPONENT') {
      // Map component names to code files
      const codeMap: { [key: string]: string } = {
        'SIGN IN': '/web/components/sign-in.tsx',
        'SETUP OVERVIEW': '/web/components/setup-overview.tsx',
        'ADD PRODUCT': '/web/components/add-product.tsx',
        'SHIPPING AND PRICING': '/web/components/shipping-pricing.tsx',
        'REGISTER': '/web/components/register-account.tsx',
        'FORGOT PASSWORD': '/web/components/forgot-password.tsx',
        'REVIEW': '/web/components/review-summary.tsx',
      };
      
      const componentName = selection.name.trim();
      const codePath = codeMap[componentName] || 'No code mapping found';
      
      figma.ui.postMessage({
        type: 'show-code',
        componentName: componentName,
        codePath: codePath,
        liveUrl: `http://localhost:3000/figma-replicas/${componentName.toLowerCase().replace(/ /g, '-')}`
      });
    } else {
      figma.ui.postMessage({
        type: 'error',
        message: 'Please select a component'
      });
    }
  }
};

