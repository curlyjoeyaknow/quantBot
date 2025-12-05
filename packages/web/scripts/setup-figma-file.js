#!/usr/bin/env node

/**
 * Figma File Setup Script
 * =======================
 * This script generates Figma-compatible JSON and instructions
 * for creating a new QuantBot design file.
 * 
 * Usage: node scripts/setup-figma-file.js
 */

const fs = require('fs');
const path = require('path');

// Design tokens from the design system
const designTokens = require('../figma-design-tokens.json');

// Generate Figma file structure JSON
function generateFigmaFileStructure() {
  return {
    name: 'QuantBot Trading Platform - New Design',
    type: 'FILE',
    document: {
      id: '0:0',
      name: 'QuantBot Trading Platform',
      type: 'DOCUMENT',
      children: [
        {
          id: '1:0',
          name: '🎨 Design System',
          type: 'PAGE',
          children: generateDesignSystemPage()
        },
        {
          id: '2:0',
          name: '📦 Components',
          type: 'PAGE',
          children: generateComponentsPage()
        },
        {
          id: '3:0',
          name: '📊 Dashboard',
          type: 'PAGE',
          children: generateDashboardPage()
        },
        {
          id: '4:0',
          name: '⚙️ Strategy Configuration',
          type: 'PAGE',
          children: []
        },
        {
          id: '5:0',
          name: '📈 Simulation Results',
          type: 'PAGE',
          children: []
        },
        {
          id: '6:0',
          name: '🔴 Live Trading',
          type: 'PAGE',
          children: []
        },
        {
          id: '7:0',
          name: '💼 Portfolio',
          type: 'PAGE',
          children: []
        }
      ]
    },
    styles: generateStyles(),
    componentSets: []
  };
}

function generateDesignSystemPage() {
  return [
    {
      id: '1:1',
      name: 'Colors',
      type: 'FRAME',
      layoutMode: 'HORIZONTAL',
      paddingLeft: 32,
      paddingRight: 32,
      paddingTop: 32,
      paddingBottom: 32,
      itemSpacing: 16,
      children: generateColorSwatches()
    },
    {
      id: '1:2',
      name: 'Typography',
      type: 'FRAME',
      layoutMode: 'VERTICAL',
      paddingLeft: 32,
      paddingRight: 32,
      paddingTop: 32,
      paddingBottom: 32,
      itemSpacing: 16,
      children: generateTypographySamples()
    },
    {
      id: '1:3',
      name: 'Spacing',
      type: 'FRAME',
      layoutMode: 'HORIZONTAL',
      paddingLeft: 32,
      paddingRight: 32,
      paddingTop: 32,
      paddingBottom: 32,
      itemSpacing: 16,
      children: generateSpacingSamples()
    }
  ];
}

function generateColorSwatches() {
  const colors = designTokens.colors;
  const swatches = [];

  // Background colors
  Object.entries(colors.background).forEach(([name, token]) => {
    swatches.push({
      id: `color-bg-${name}`,
      name: `Background/${name}`,
      type: 'RECTANGLE',
      fills: [{ type: 'SOLID', color: hexToRgb(token.value) }],
      cornerRadius: 8,
      width: 120,
      height: 80,
      children: [
        {
          type: 'TEXT',
          characters: name,
          style: {
            fontSize: 12,
            fillStyleId: 'text-secondary'
          }
        }
      ]
    });
  });

  // Accent colors
  Object.entries(colors.accent).forEach(([name, token]) => {
    swatches.push({
      id: `color-accent-${name}`,
      name: `Accent/${name}`,
      type: 'RECTANGLE',
      fills: [{ type: 'SOLID', color: hexToRgb(token.value) }],
      cornerRadius: 8,
      width: 120,
      height: 80
    });
  });

  return swatches;
}

function generateTypographySamples() {
  const typography = designTokens.typography;
  const samples = [];

  Object.entries(typography.fontSize).forEach(([name, token]) => {
    const weight = name.includes('h') || name === 'display' ? 'bold' : 'regular';
    samples.push({
      id: `text-${name}`,
      name: name.toUpperCase(),
      type: 'TEXT',
      characters: `The quick brown fox jumps over the lazy dog`,
      style: {
        fontSize: parseInt(token.value),
        fontWeight: typography.fontWeight[weight]?.value || 400,
        fontFamily: typography.fontFamily.primary.value.split(',')[0],
        lineHeight: typography.lineHeight.normal.value
      }
    });
  });

  return samples;
}

function generateSpacingSamples() {
  const spacing = designTokens.spacing;
  const samples = [];

  Object.entries(spacing).forEach(([name, token]) => {
    const size = parseInt(token.value);
    samples.push({
      id: `spacing-${name}`,
      name: name,
      type: 'RECTANGLE',
      width: size,
      height: size,
      fills: [{ type: 'SOLID', color: { r: 0.2, g: 0.2, b: 0.2 } }],
      cornerRadius: 4,
      children: [
        {
          type: 'TEXT',
          characters: token.value,
          style: {
            fontSize: 10,
            fillStyleId: 'text-muted'
          }
        }
      ]
    });
  });

  return samples;
}

function generateComponentsPage() {
  return [
    {
      id: '2:1',
      name: 'Buttons',
      type: 'FRAME',
      layoutMode: 'HORIZONTAL',
      paddingLeft: 32,
      paddingRight: 32,
      paddingTop: 32,
      paddingBottom: 32,
      itemSpacing: 16,
      children: generateButtonComponents()
    },
    {
      id: '2:2',
      name: 'Cards',
      type: 'FRAME',
      layoutMode: 'HORIZONTAL',
      paddingLeft: 32,
      paddingRight: 32,
      paddingTop: 32,
      paddingBottom: 32,
      itemSpacing: 16,
      children: generateCardComponents()
    },
    {
      id: '2:3',
      name: 'Inputs',
      type: 'FRAME',
      layoutMode: 'VERTICAL',
      paddingLeft: 32,
      paddingRight: 32,
      paddingTop: 32,
      paddingBottom: 32,
      itemSpacing: 16,
      children: generateInputComponents()
    }
  ];
}

function generateButtonComponents() {
  return [
    {
      id: 'btn-primary',
      name: 'Button/Primary',
      type: 'COMPONENT',
      layoutMode: 'HORIZONTAL',
      paddingLeft: 24,
      paddingRight: 24,
      paddingTop: 12,
      paddingBottom: 12,
      cornerRadius: 8,
      fills: [{ type: 'SOLID', color: hexToRgb(designTokens.colors.interactive.primary.value) }],
      width: 120,
      height: 44,
      children: [
        {
          type: 'TEXT',
          characters: 'Button',
          style: {
            fontSize: 14,
            fontWeight: 500,
            fillStyleId: 'text-primary'
          }
        }
      ]
    }
  ];
}

function generateCardComponents() {
  return [
    {
      id: 'card-metric',
      name: 'Card/Metric',
      type: 'COMPONENT',
      layoutMode: 'VERTICAL',
      paddingLeft: 24,
      paddingRight: 24,
      paddingTop: 24,
      paddingBottom: 24,
      cornerRadius: 12,
      fills: [{ type: 'SOLID', color: hexToRgb(designTokens.colors.background.secondary.value) }],
      strokes: [{ type: 'SOLID', color: hexToRgb(designTokens.colors.interactive.border.value) }],
      strokeWeight: 1,
      width: 280,
      height: 160
    }
  ];
}

function generateInputComponents() {
  return [
    {
      id: 'input-text',
      name: 'Input/Text',
      type: 'COMPONENT',
      layoutMode: 'HORIZONTAL',
      paddingLeft: 16,
      paddingRight: 16,
      paddingTop: 12,
      paddingBottom: 12,
      cornerRadius: 8,
      fills: [{ type: 'SOLID', color: hexToRgb(designTokens.colors.background.primary.value) }],
      strokes: [{ type: 'SOLID', color: hexToRgb(designTokens.colors.interactive.border.value) }],
      strokeWeight: 1,
      width: 300,
      height: 44
    }
  ];
}

function generateDashboardPage() {
  return [
    {
      id: '3:1',
      name: 'Dashboard Layout',
      type: 'FRAME',
      width: 1920,
      height: 1080,
      fills: [{ type: 'SOLID', color: hexToRgb(designTokens.colors.background.primary.value) }],
      layoutMode: 'VERTICAL',
      paddingLeft: 32,
      paddingRight: 32,
      paddingTop: 32,
      paddingBottom: 32,
      itemSpacing: 32,
      children: [
        {
          id: '3:2',
          name: 'Header',
          type: 'FRAME',
          layoutMode: 'HORIZONTAL',
          width: 'fill-parent',
          height: 80,
          children: [
            {
              type: 'TEXT',
              characters: 'Trading Dashboard',
              style: {
                fontSize: 36,
                fontWeight: 700,
                fillStyleId: 'text-primary'
              }
            }
          ]
        },
        {
          id: '3:3',
          name: 'Metrics Grid',
          type: 'FRAME',
          layoutMode: 'HORIZONTAL',
          width: 'fill-parent',
          itemSpacing: 24,
          children: generateMetricCards()
        }
      ]
    }
  ];
}

function generateMetricCards() {
  const cards = [];
  for (let i = 0; i < 8; i++) {
    cards.push({
      id: `metric-${i}`,
      name: `Metric Card ${i + 1}`,
      type: 'INSTANCE',
      componentId: 'card-metric',
      width: 280,
      height: 160
    });
  }
  return cards;
}

function generateStyles() {
  return {
    fills: generateFillStyles(),
    text: generateTextStyles(),
    effects: generateEffectStyles()
  };
}

function generateFillStyles() {
  const styles = [];
  const colors = designTokens.colors;

  // Background styles
  Object.entries(colors.background).forEach(([name, token]) => {
    styles.push({
      id: `fill-bg-${name}`,
      name: `Background/${name}`,
      type: 'FILL',
      fills: [{ type: 'SOLID', color: hexToRgb(token.value) }]
    });
  });

  // Accent styles
  Object.entries(colors.accent).forEach(([name, token]) => {
    styles.push({
      id: `fill-accent-${name}`,
      name: `Accent/${name}`,
      type: 'FILL',
      fills: [{ type: 'SOLID', color: hexToRgb(token.value) }]
    });
  });

  return styles;
}

function generateTextStyles() {
  const styles = [];
  const typography = designTokens.typography;

  Object.entries(typography.fontSize).forEach(([name, token]) => {
    const weight = name.includes('h') || name === 'display' ? 'bold' : 'regular';
    styles.push({
      id: `text-${name}`,
      name: name.toUpperCase(),
      type: 'TEXT',
      fontSize: parseInt(token.value),
      fontWeight: parseInt(typography.fontWeight[weight]?.value || 400),
      fontFamily: typography.fontFamily.primary.value.split(',')[0],
      lineHeight: {
        value: parseFloat(typography.lineHeight.normal.value) * parseInt(token.value),
        unit: 'PIXELS'
      }
    });
  });

  return styles;
}

function generateEffectStyles() {
  return [
    {
      id: 'shadow-sm',
      name: 'Shadow/Small',
      type: 'EFFECT',
      effects: [{
        type: 'DROP_SHADOW',
        color: { r: 0, g: 0, b: 0, a: 0.1 },
        offset: { x: 0, y: 1 },
        radius: 2,
        visible: true
      }]
    },
    {
      id: 'shadow-md',
      name: 'Shadow/Medium',
      type: 'EFFECT',
      effects: [{
        type: 'DROP_SHADOW',
        color: { r: 0, g: 0, b: 0, a: 0.2 },
        offset: { x: 0, y: 4 },
        radius: 6,
        visible: true
      }]
    }
  ];
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255
  } : { r: 0, g: 0, b: 0 };
}

// Generate the file structure
const figmaStructure = generateFigmaFileStructure();

// Save to file
const outputPath = path.join(__dirname, '../figma-file-structure.json');
fs.writeFileSync(outputPath, JSON.stringify(figmaStructure, null, 2));

console.log('✅ Figma file structure generated!');
console.log(`📁 Saved to: ${outputPath}`);
console.log('\n📋 Next steps:');
console.log('1. Open Figma Desktop or Web');
console.log('2. Create a new design file');
console.log('3. Use the "Import" feature or manually set up using:');
console.log('   - figma-design-tokens.json (for design tokens)');
console.log('   - FIGMA_COMPONENT_SPECS.md (for component specs)');
console.log('   - figma-file-structure.json (for file structure reference)');
console.log('\n💡 Tip: Use Figma plugins like "Design Tokens" to import the JSON file');

