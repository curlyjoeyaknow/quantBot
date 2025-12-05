/**
 * Figma Plugin: Convert Frames to Components
 * 
 * INSTALLATION:
 * 1. Open Figma Desktop
 * 2. Go to Plugins → Development → New Plugin
 * 3. Choose "Empty" template, name it "Frame to Component Converter"
 * 4. Replace code.ts with this file
 * 5. Save and run the plugin
 * 
 * This will convert all specified frames to components automatically.
 */

// Node IDs to convert (from your Shopify file)
const NODE_IDS = [
  '144:2360',   // SIGN IN
  '218:739',    // SETUP OVERVIEW
  '218:762',    // ADD PRODUCT
  '304:543',    // SHIPPING AND PRICING
];

async function convertFramesToComponents() {
  let successCount = 0;
  let failCount = 0;
  const errors: string[] = [];

  for (const nodeId of NODE_IDS) {
    try {
      // Get the node using Plugin API
      const node = figma.getNodeById(nodeId) as SceneNode;
      
      if (!node) {
        const errorMsg = `Node ${nodeId} not found`;
        console.error(errorMsg);
        errors.push(errorMsg);
        failCount++;
        continue;
      }
      
      // Check if it's a frame
      if (node.type !== 'FRAME') {
        const errorMsg = `Node ${nodeId} (${node.name}) is type ${node.type}, not FRAME`;
        console.warn(errorMsg);
        errors.push(errorMsg);
        failCount++;
        continue;
      }
      
      // Store original properties
      const originalName = node.name;
      const originalX = node.x;
      const originalY = node.y;
      
      // Create a component from the frame
      // Method 1: Using createComponentFromNode (if available)
      if (typeof (figma as any).createComponentFromNode === 'function') {
        (figma as any).createComponentFromNode(node);
        console.log(`✅ Converted ${originalName} (${nodeId}) to component using createComponentFromNode`);
        successCount++;
      } else {
        // Method 2: Manual conversion
        const parent = node.parent;
        if (!parent) {
          throw new Error('Node has no parent');
        }
        
        // Create new component
        const component = figma.createComponent();
        component.name = originalName;
        component.x = originalX;
        component.y = originalY;
        component.resize(node.width, node.height);
        
        // Copy all children
        const children = [...node.children];
        for (const child of children) {
          const clonedChild = child.clone();
          component.appendChild(clonedChild);
        }
        
        // Copy other properties
        if ('fills' in node && 'fills' in component) {
          component.fills = JSON.parse(JSON.stringify(node.fills));
        }
        if ('strokes' in node && 'strokes' in component) {
          component.strokes = JSON.parse(JSON.stringify(node.strokes));
        }
        if ('effects' in node && 'effects' in component) {
          component.effects = JSON.parse(JSON.stringify(node.effects));
        }
        if ('cornerRadius' in node && 'cornerRadius' in component) {
          component.cornerRadius = node.cornerRadius;
        }
        if ('constraints' in node && 'constraints' in component) {
          component.constraints = node.constraints;
        }
        if ('layoutMode' in node && 'layoutMode' in component) {
          component.layoutMode = node.layoutMode;
        }
        
        // Insert component at same position in hierarchy
        const nodeIndex = parent.children.indexOf(node);
        parent.insertChild(nodeIndex, component);
        
        // Remove original frame
        node.remove();
        
        console.log(`✅ Converted ${originalName} (${nodeId}) to component (manual method)`);
        successCount++;
      }
      
    } catch (error) {
      const errorMsg = `Error converting ${nodeId}: ${error.message}`;
      console.error(errorMsg);
      errors.push(errorMsg);
      failCount++;
    }
  }
  
  // Summary message
  let message = `Conversion complete!\n\n`;
  message += `✅ Success: ${successCount}\n`;
  message += `❌ Failed: ${failCount}\n`;
  
  if (errors.length > 0) {
    message += `\nErrors:\n${errors.join('\n')}`;
  }
  
  figma.notify(message, { timeout: 5000 });
  figma.closePlugin(message);
}

// Run the conversion
convertFramesToComponents();

