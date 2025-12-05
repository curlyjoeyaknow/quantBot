"use strict";
/**
 * QuantBot Design System Setup Plugin
 * ====================================
 * Automates the creation of QuantBot design system in Figma:
 * - Creates pages structure
 * - Sets up design tokens (colors, typography, spacing)
 * - Creates component library
 * - Sets up design system documentation
 */
// Design tokens data
const designTokens = {
    colors: {
        background: {
            primary: "#0F172A",
            secondary: "#1E293B",
            tertiary: "#334155",
            elevated: "#475569"
        },
        text: {
            primary: "#FFFFFF",
            secondary: "#CBD5E1",
            tertiary: "#94A3B8",
            muted: "#64748B"
        },
        accent: {
            success: "#10B981",
            successLight: "#34D399",
            danger: "#EF4444",
            dangerLight: "#F87171",
            warning: "#F59E0B",
            info: "#3B82F6",
            infoLight: "#60A5FA"
        },
        interactive: {
            primary: "#6366F1",
            primaryHover: "#818CF8",
            secondary: "#334155",
            border: "#475569",
            borderHover: "#64748B"
        }
    },
    spacing: {
        xs: "4px",
        sm: "8px",
        md: "16px",
        lg: "24px",
        xl: "32px",
        "2xl": "48px",
        "3xl": "64px"
    },
    typography: {
        fontFamily: {
            primary: "Inter",
            mono: "JetBrains Mono"
        },
        fontSize: {
            display: "48px",
            h1: "36px",
            h2: "30px",
            h3: "24px",
            h4: "20px",
            bodyLarge: "18px",
            body: "16px",
            bodySmall: "14px",
            caption: "12px"
        },
        fontWeight: {
            regular: 400,
            medium: 500,
            semibold: 600,
            bold: 700
        },
        lineHeight: {
            tight: 1.2,
            normal: 1.5,
            relaxed: 1.75
        }
    },
    borderRadius: {
        sm: "4px",
        md: "8px",
        lg: "12px",
        xl: "16px",
        full: "9999px"
    }
};
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
// Create pages
function createPages() {
    const pages = [
        "🎨 Design System",
        "📦 Components",
        "📊 Dashboard",
        "⚙️ Strategy Configuration",
        "📈 Simulation Results",
        "🔴 Live Trading",
        "💼 Portfolio"
    ];
    const createdPages = [];
    pages.forEach((pageName) => {
        // Check if page already exists
        const existingPage = figma.root.children.find((page) => page.name === pageName);
        if (existingPage) {
            createdPages.push(existingPage);
        }
        else {
            const page = figma.createPage();
            page.name = pageName;
            createdPages.push(page);
        }
    });
    return createdPages;
}
// Create color styles
async function createColorStyles() {
    const colorStyles = [];
    // Background colors
    Object.entries(designTokens.colors.background).forEach(([name, value]) => {
        const style = figma.createPaintStyle();
        style.name = `Background/${name}`;
        style.paints = [{ type: "SOLID", color: hexToRgb(value) }];
        colorStyles.push(style);
    });
    // Text colors
    Object.entries(designTokens.colors.text).forEach(([name, value]) => {
        const style = figma.createPaintStyle();
        style.name = `Text/${name}`;
        style.paints = [{ type: "SOLID", color: hexToRgb(value) }];
        colorStyles.push(style);
    });
    // Accent colors
    Object.entries(designTokens.colors.accent).forEach(([name, value]) => {
        const style = figma.createPaintStyle();
        style.name = `Accent/${name}`;
        style.paints = [{ type: "SOLID", color: hexToRgb(value) }];
        colorStyles.push(style);
    });
    // Interactive colors
    Object.entries(designTokens.colors.interactive).forEach(([name, value]) => {
        const style = figma.createPaintStyle();
        style.name = `Interactive/${name}`;
        style.paints = [{ type: "SOLID", color: hexToRgb(value) }];
        colorStyles.push(style);
    });
    return colorStyles;
}
// Create text styles
async function createTextStyles() {
    const textStyles = [];
    // Load Inter font (or fallback to system font)
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    await figma.loadFontAsync({ family: "Inter", style: "Medium" });
    await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
    await figma.loadFontAsync({ family: "Inter", style: "Bold" });
    Object.entries(designTokens.typography.fontSize).forEach(([name, size]) => {
        const sizeNum = parseInt(size);
        let weight = designTokens.typography.fontWeight.regular;
        let styleName = "Regular";
        // Determine weight based on name
        if (name === "display" || name.startsWith("h")) {
            weight = designTokens.typography.fontWeight.bold;
            styleName = "Bold";
        }
        else if (name === "bodySmall" || name === "caption") {
            weight = designTokens.typography.fontWeight.regular;
            styleName = "Regular";
        }
        else {
            weight = designTokens.typography.fontWeight.medium;
            styleName = "Medium";
        }
        try {
            const textStyle = figma.createTextStyle();
            textStyle.name = name.toUpperCase();
            textStyle.fontSize = sizeNum;
            textStyle.fontName = { family: "Inter", style: styleName };
            textStyle.lineHeight = {
                value: sizeNum * designTokens.typography.lineHeight.normal,
                unit: "PIXELS",
            };
            textStyles.push(textStyle);
        }
        catch (error) {
            console.warn(`Could not create text style ${name}:`, error);
        }
    });
    return textStyles;
}
// Create design system page content
function createDesignSystemPage(page) {
    page.name = "🎨 Design System";
    // Colors section
    const colorsFrame = figma.createFrame();
    colorsFrame.name = "Colors";
    colorsFrame.layoutMode = "HORIZONTAL";
    colorsFrame.paddingLeft = 32;
    colorsFrame.paddingRight = 32;
    colorsFrame.paddingTop = 32;
    colorsFrame.paddingBottom = 32;
    colorsFrame.itemSpacing = 16;
    colorsFrame.fills = [{ type: "SOLID", color: hexToRgb("#0F172A") }];
    colorsFrame.x = 0;
    colorsFrame.y = 0;
    // Create color swatches
    Object.entries(designTokens.colors.background).forEach(([name, value]) => {
        const swatch = figma.createRectangle();
        swatch.name = name;
        swatch.resize(120, 80);
        swatch.fills = [{ type: "SOLID", color: hexToRgb(value) }];
        swatch.cornerRadius = 8;
        colorsFrame.appendChild(swatch);
    });
    page.appendChild(colorsFrame);
    // Typography section
    const typographyFrame = figma.createFrame();
    typographyFrame.name = "Typography";
    typographyFrame.layoutMode = "VERTICAL";
    typographyFrame.paddingLeft = 32;
    typographyFrame.paddingRight = 32;
    typographyFrame.paddingTop = 32;
    typographyFrame.paddingBottom = 32;
    typographyFrame.itemSpacing = 16;
    typographyFrame.fills = [{ type: "SOLID", color: hexToRgb("#0F172A") }];
    typographyFrame.x = 600;
    typographyFrame.y = 0;
    page.appendChild(typographyFrame);
}
// Create base components
async function createBaseComponents(page) {
    page.name = "📦 Components";
    await figma.loadFontAsync({ family: "Inter", style: "Medium" });
    // Button component
    const buttonFrame = figma.createFrame();
    buttonFrame.name = "Button/Primary";
    buttonFrame.resize(120, 44);
    buttonFrame.fills = [{ type: "SOLID", color: hexToRgb("#6366F1") }];
    buttonFrame.cornerRadius = 8;
    buttonFrame.layoutMode = "HORIZONTAL";
    buttonFrame.paddingLeft = 24;
    buttonFrame.paddingRight = 24;
    buttonFrame.paddingTop = 12;
    buttonFrame.paddingBottom = 12;
    buttonFrame.horizontalPadding = 24;
    buttonFrame.verticalPadding = 12;
    const buttonText = figma.createText();
    buttonText.characters = "Button";
    buttonText.fontSize = 14;
    buttonText.fontName = { family: "Inter", style: "Medium" };
    buttonText.fills = [{ type: "SOLID", color: hexToRgb("#FFFFFF") }];
    buttonFrame.appendChild(buttonText);
    const buttonComponent = figma.createComponent();
    buttonComponent.name = "Button/Primary";
    buttonComponent.resize(120, 44);
    buttonComponent.fills = [{ type: "SOLID", color: hexToRgb("#6366F1") }];
    buttonComponent.cornerRadius = 8;
    buttonComponent.appendChild(buttonText);
    buttonComponent.x = 0;
    buttonComponent.y = 0;
    page.appendChild(buttonComponent);
    // Card component
    const cardComponent = figma.createComponent();
    cardComponent.name = "Card/Metric";
    cardComponent.resize(280, 160);
    cardComponent.fills = [{ type: "SOLID", color: hexToRgb("#1E293B") }];
    cardComponent.strokes = [{ type: "SOLID", color: hexToRgb("#475569") }];
    cardComponent.strokeWeight = 1;
    cardComponent.cornerRadius = 12;
    cardComponent.x = 200;
    cardComponent.y = 0;
    page.appendChild(cardComponent);
    // Input component
    const inputComponent = figma.createComponent();
    inputComponent.name = "Input/Text";
    inputComponent.resize(300, 44);
    inputComponent.fills = [{ type: "SOLID", color: hexToRgb("#0F172A") }];
    inputComponent.strokes = [{ type: "SOLID", color: hexToRgb("#475569") }];
    inputComponent.strokeWeight = 1;
    inputComponent.cornerRadius = 8;
    inputComponent.x = 0;
    inputComponent.y = 200;
    page.appendChild(inputComponent);
}
// Create dashboard layout
function createDashboardLayout(page) {
    page.name = "📊 Dashboard";
    const mainFrame = figma.createFrame();
    mainFrame.name = "Dashboard Layout";
    mainFrame.resize(1920, 1080);
    mainFrame.fills = [{ type: "SOLID", color: hexToRgb("#0F172A") }];
    mainFrame.layoutMode = "VERTICAL";
    mainFrame.paddingLeft = 32;
    mainFrame.paddingRight = 32;
    mainFrame.paddingTop = 32;
    mainFrame.paddingBottom = 32;
    mainFrame.itemSpacing = 32;
    // Header
    const headerFrame = figma.createFrame();
    headerFrame.name = "Header";
    headerFrame.layoutMode = "HORIZONTAL";
    headerFrame.resize(1856, 80);
    headerFrame.fills = [];
    page.appendChild(mainFrame);
    mainFrame.appendChild(headerFrame);
    // Metrics grid placeholder
    const metricsFrame = figma.createFrame();
    metricsFrame.name = "Metrics Grid";
    metricsFrame.layoutMode = "HORIZONTAL";
    metricsFrame.resize(1856, 160);
    metricsFrame.itemSpacing = 24;
    metricsFrame.fills = [];
    mainFrame.appendChild(metricsFrame);
}
// Main setup function
async function setupQuantBotDesignSystem() {
    try {
        figma.notify("🚀 Starting QuantBot Design System setup...", { timeout: 2000 });
        // Create pages
        const pages = createPages();
        figma.notify("✅ Pages created", { timeout: 1000 });
        // Create color styles
        await createColorStyles();
        figma.notify("✅ Color styles created", { timeout: 1000 });
        // Create text styles
        await createTextStyles();
        figma.notify("✅ Text styles created", { timeout: 1000 });
        // Set up design system page
        const designSystemPage = pages.find((p) => p.name === "🎨 Design System");
        if (designSystemPage) {
            createDesignSystemPage(designSystemPage);
            figma.currentPage = designSystemPage;
        }
        // Set up components page
        const componentsPage = pages.find((p) => p.name === "📦 Components");
        if (componentsPage) {
            await createBaseComponents(componentsPage);
        }
        // Set up dashboard page
        const dashboardPage = pages.find((p) => p.name === "📊 Dashboard");
        if (dashboardPage) {
            createDashboardLayout(dashboardPage);
        }
        figma.notify("🎉 QuantBot Design System setup complete!", { timeout: 3000 });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        figma.notify(`❌ Error: ${errorMessage}`, { timeout: 5000 });
        console.error(error);
    }
}
// Handle messages from UI
figma.ui.onmessage = (msg) => {
    if (msg.type === "setup") {
        setupQuantBotDesignSystem();
    }
    else if (msg.type === "cancel") {
        figma.closePlugin();
    }
};
// Show UI
figma.showUI(__html__, { width: 400, height: 500 });
