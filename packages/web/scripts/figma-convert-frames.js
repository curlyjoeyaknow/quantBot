/**
 * Figma Plugin Script: Convert Frames to Components
 * 
 * HOW TO USE:
 * 1. Open Figma: https://www.figma.com/design/dfD3nN79LuyG7Fjs6BnDxZ/Shopify
 * 2. Open Developer Console: Ctrl+Shift+I (Windows/Linux) or Cmd+Option+I (Mac)
 * 3. Go to "Plugins" > "Development" > "New Plugin..." > "Create"
 * 4. Replace the code.ts content with this script
 * 5. Click "Run"
 */

// Node IDs to convert to components
const NODE_IDS = [
  '144:2360',   // SIGN IN
  '218:739',    // SETUP OVERVIEW
  '218:762',    // ADD PRODUCT
  '304:543',    // SHIPPING AND PRICING
];

async function convertFramesToComponents() {
  console.log('🎨 Starting conversion...');
  
  for (const nodeId of NODE_IDS) {
    try {
      // Get the node by ID
      const node = figma.getNodeById(nodeId);
      
      if (!node) {
        console.log(`❌ Node ${nodeId} not found`);
        continue;
      }
      
      // Check if it's a frame
      if (node.type !== 'FRAME') {
        console.log(`⚠️  Node ${nodeId} (${node.name}) is not a frame, skipping`);
        continue;
      }
      
      // Create component from frame
      const component = figma.createComponent();
      
      // Copy all properties from frame to component
      component.name = node.name;
      component.x = node.x;
      component.y = node.y;
      component.resize(node.width, node.height);
      
      // Move all children from frame to component
      const children = [...node.children];
      for (const child of children) {
        component.appendChild(child);
      }
      
      // Remove the original frame
      node.remove();
      
      console.log(`✅ Converted ${component.name} (${nodeId}) to component`);
      
    } catch (error) {
      console.log(`❌ Error converting ${nodeId}:`, error.message);
    }
  }
  
  console.log('✨ Conversion complete!');
  figma.closePlugin('All frames converted to components!');
}

convertFramesToComponents();

