#!/usr/bin/env tsx
/**
 * HTML Documentation Generator
 *
 * Generates a complete HTML documentation site from the docs/ directory structure.
 * Preserves directory hierarchy and creates navigation.
 */

import { readdir, readFile, writeFile, mkdir, stat } from 'fs/promises';
import { join, relative, dirname, basename, extname, resolve } from 'path';
import { existsSync } from 'fs';

interface DocFile {
  path: string;
  relativePath: string;
  title: string;
  content: string;
  html: string;
  category: string;
}

interface DocCategory {
  name: string;
  files: DocFile[];
  subcategories: Map<string, DocCategory>;
}

// Simple markdown to HTML converter (basic implementation)
function markdownToHtml(markdown: string): string {
  let html = markdown;

  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.*?)_/g, '<em>$1</em>');

  // Code blocks
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
    const language = lang || 'text';
    return `<pre><code class="language-${language}">${escapeHtml(code.trim())}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
    // Convert relative .md links to .html
    if (url.endsWith('.md')) {
      url = url.replace(/\.md$/, '.html');
    }
    // Handle relative paths
    if (
      url.startsWith('./') ||
      url.startsWith('../') ||
      (!url.startsWith('http') && !url.startsWith('#'))
    ) {
      // Keep relative links as-is for now
    }
    return `<a href="${url}">${text}</a>`;
  });

  // Lists
  html = html.replace(/^- (.*$)/gim, '<li>$1</li>');
  html = html.replace(/^\d+\. (.*$)/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

  // Paragraphs (lines not starting with <)
  html = html
    .split('\n')
    .map((line) => {
      if (line.trim() === '') return '';
      if (line.trim().startsWith('<')) return line;
      if (line.startsWith('#') || line.startsWith('-') || line.match(/^\d+\./)) return line;
      return `<p>${line}</p>`;
    })
    .join('\n');

  // Horizontal rules
  html = html.replace(/^---$/gim, '<hr>');
  html = html.replace(/^___$/gim, '<hr>');

  // Clean up empty paragraphs
  html = html.replace(/<p><\/p>/g, '');

  // Line breaks
  html = html.replace(/\n/g, '<br>\n');

  return html;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

function extractTitle(content: string, filePath: string): string {
  // Try to extract from first h1
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) {
    return h1Match[1].trim();
  }

  // Fallback to filename
  const filename = basename(filePath, extname(filePath));
  return filename
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

async function readDocFile(filePath: string, docsRoot: string): Promise<DocFile | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const relativePath = relative(docsRoot, filePath);
    const title = extractTitle(content, filePath);
    const html = markdownToHtml(content);

    // Determine category from directory structure
    const parts = relativePath.split('/');
    const category = parts.length > 1 ? parts[0] : 'root';

    return {
      path: filePath,
      relativePath,
      title,
      content,
      html,
      category,
    };
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
    return null;
  }
}

async function scanDocsDirectory(dir: string, docsRoot: string): Promise<DocFile[]> {
  const files: DocFile[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    // Skip hidden files and node_modules
    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue;
    }

    if (entry.isDirectory()) {
      // Recursively scan subdirectories
      const subFiles = await scanDocsDirectory(fullPath, docsRoot);
      files.push(...subFiles);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      // Skip README.md files in root (we'll use docs/README.md as index)
      if (entry.name === 'README.md' && dir === docsRoot) {
        continue;
      }

      const docFile = await readDocFile(fullPath, docsRoot);
      if (docFile) {
        files.push(docFile);
      }
    }
  }

  return files;
}

function organizeByCategory(files: DocFile[]): DocCategory {
  const root: DocCategory = {
    name: 'root',
    files: [],
    subcategories: new Map(),
  };

  for (const file of files) {
    const parts = file.relativePath.split('/').filter((p) => p !== '');

    if (parts.length === 1) {
      // Root level file
      root.files.push(file);
    } else {
      // Categorized file
      const categoryName = parts[0];
      let category = root.subcategories.get(categoryName);

      if (!category) {
        category = {
          name: categoryName,
          files: [],
          subcategories: new Map(),
        };
        root.subcategories.set(categoryName, category);
      }

      // Handle nested paths (e.g., architecture/archive/file.md)
      if (parts.length > 2) {
        let currentCategory = category;
        for (let i = 1; i < parts.length - 1; i++) {
          const subName = parts[i];
          let subCategory = currentCategory.subcategories.get(subName);
          if (!subCategory) {
            subCategory = {
              name: subName,
              files: [],
              subcategories: new Map(),
            };
            currentCategory.subcategories.set(subName, subCategory);
          }
          currentCategory = subCategory;
        }
        currentCategory.files.push(file);
      } else {
        category.files.push(file);
      }
    }
  }

  return root;
}

function generateNavigation(
  category: DocCategory,
  currentPath: string = '',
  level: number = 0
): string {
  let html = '';

  if (level === 0) {
    html += '<nav class="sidebar">\n';
    html += '<div class="nav-header">\n';
    html += '<h2>Documentation</h2>\n';
    html += '</div>\n';
    html += '<ul class="nav-list">\n';
  }

  // Add category files
  for (const file of category.files.sort((a, b) => a.title.localeCompare(b.title))) {
    const filePath = file.relativePath.replace(/\.md$/, '.html');
    const isActive = filePath === currentPath ? ' class="active"' : '';
    html += `  ${'  '.repeat(level)}<li${isActive}><a href="${filePath}">${escapeHtml(file.title)}</a></li>\n`;
  }

  // Add subcategories
  for (const [name, subcategory] of Array.from(category.subcategories.entries()).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    html += `  ${'  '.repeat(level)}<li class="nav-category">\n`;
    html += `  ${'  '.repeat(level)}  <span class="category-name">${escapeHtml(name)}</span>\n`;
    html += `  ${'  '.repeat(level)}  <ul>\n`;
    // Generate navigation for subcategory (recursive)
    html += generateNavigationRecursive(subcategory, currentPath, level + 1);
    html += `  ${'  '.repeat(level)}  </ul>\n`;
    html += `  ${'  '.repeat(level)}</li>\n`;
  }

  if (level === 0) {
    html += '</ul>\n';
    html += '</nav>\n';
  }

  return html;
}

function generateNavigationRecursive(
  category: DocCategory,
  currentPath: string,
  level: number
): string {
  let html = '';

  // Add category files
  for (const file of category.files.sort((a, b) => a.title.localeCompare(b.title))) {
    const filePath = file.relativePath.replace(/\.md$/, '.html');
    const isActive = filePath === currentPath ? ' class="active"' : '';
    html += `  ${'  '.repeat(level)}<li${isActive}><a href="${filePath}">${escapeHtml(file.title)}</a></li>\n`;
  }

  // Add subcategories
  for (const [name, subcategory] of Array.from(category.subcategories.entries()).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    html += `  ${'  '.repeat(level)}<li class="nav-category">\n`;
    html += `  ${'  '.repeat(level)}  <span class="category-name">${escapeHtml(name)}</span>\n`;
    html += `  ${'  '.repeat(level)}  <ul>\n`;
    html += generateNavigationRecursive(subcategory, currentPath, level + 1);
    html += `  ${'  '.repeat(level)}  </ul>\n`;
    html += `  ${'  '.repeat(level)}</li>\n`;
  }

  return html;
}

function generateIndexPage(category: DocCategory): string {
  const nav = generateNavigation(category, 'index.html');

  let content = '<div class="index-content">\n';
  content += '<h1>QuantBot Documentation</h1>\n';
  content += '<p>Welcome to the QuantBot documentation. Explore the sections below:</p>\n\n';

  // Generate category sections
  for (const [name, subcategory] of Array.from(category.subcategories.entries()).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    content += `<h2>${escapeHtml(name)}</h2>\n`;
    content += '<ul>\n';
    for (const file of subcategory.files.sort((a, b) => a.title.localeCompare(b.title))) {
      const filePath = file.relativePath.replace(/\.md$/, '.html');
      content += `  <li><a href="${filePath}">${escapeHtml(file.title)}</a></li>\n`;
    }

    // Add nested subcategories
    for (const [subName, subSubCategory] of Array.from(subcategory.subcategories.entries()).sort(
      ([a], [b]) => a.localeCompare(b)
    )) {
      content += `  <li><strong>${escapeHtml(subName)}</strong>\n`;
      content += '    <ul>\n';
      for (const file of subSubCategory.files.sort((a, b) => a.title.localeCompare(b.title))) {
        const filePath = file.relativePath.replace(/\.md$/, '.html');
        content += `      <li><a href="${filePath}">${escapeHtml(file.title)}</a></li>\n`;
      }
      content += '    </ul>\n';
      content += '  </li>\n';
    }

    content += '</ul>\n\n';
  }

  content += '</div>\n';

  return generatePageHtml('QuantBot Documentation', content, nav, 'index.html');
}

function generatePageHtml(
  title: string,
  content: string,
  navigation: string,
  currentPath: string
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - QuantBot Docs</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background: #f5f5f5;
      display: flex;
      min-height: 100vh;
    }

    .sidebar {
      width: 280px;
      background: #2d3748;
      color: #e2e8f0;
      overflow-y: auto;
      position: fixed;
      height: 100vh;
      padding: 1.5rem 0;
      box-shadow: 2px 0 8px rgba(0,0,0,0.1);
    }

    .nav-header {
      padding: 0 1.5rem 1.5rem;
      border-bottom: 1px solid #4a5568;
      margin-bottom: 1rem;
    }

    .nav-header h2 {
      color: #fff;
      font-size: 1.25rem;
      font-weight: 600;
    }

    .nav-list {
      list-style: none;
      padding: 0 1rem;
    }

    .nav-list li {
      margin: 0.25rem 0;
    }

    .nav-list a {
      display: block;
      padding: 0.5rem 1rem;
      color: #cbd5e0;
      text-decoration: none;
      border-radius: 4px;
      transition: background 0.2s;
    }

    .nav-list a:hover {
      background: #4a5568;
      color: #fff;
    }

    .nav-list a.active {
      background: #4299e1;
      color: #fff;
      font-weight: 500;
    }

    .nav-category {
      margin-top: 1rem;
    }

    .category-name {
      display: block;
      padding: 0.5rem 1rem;
      color: #9ca3af;
      font-weight: 600;
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .nav-category ul {
      list-style: none;
      padding-left: 0.5rem;
      margin-top: 0.25rem;
    }

    .main-content {
      flex: 1;
      margin-left: 280px;
      padding: 2rem 3rem;
      max-width: 1200px;
      background: white;
      min-height: 100vh;
    }

    h1 {
      font-size: 2.5rem;
      margin-bottom: 1rem;
      color: #1a202c;
      border-bottom: 3px solid #4299e1;
      padding-bottom: 0.5rem;
    }

    h2 {
      font-size: 2rem;
      margin-top: 2rem;
      margin-bottom: 1rem;
      color: #2d3748;
    }

    h3 {
      font-size: 1.5rem;
      margin-top: 1.5rem;
      margin-bottom: 0.75rem;
      color: #4a5568;
    }

    p {
      margin-bottom: 1rem;
    }

    code {
      background: #f7fafc;
      padding: 0.2rem 0.4rem;
      border-radius: 3px;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 0.9em;
      color: #e53e3e;
    }

    pre {
      background: #1a202c;
      color: #e2e8f0;
      padding: 1.5rem;
      border-radius: 6px;
      overflow-x: auto;
      margin: 1rem 0;
    }

    pre code {
      background: transparent;
      padding: 0;
      color: inherit;
      font-size: 0.875rem;
    }

    ul, ol {
      margin-left: 2rem;
      margin-bottom: 1rem;
    }

    li {
      margin: 0.5rem 0;
    }

    a {
      color: #4299e1;
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    hr {
      border: none;
      border-top: 1px solid #e2e8f0;
      margin: 2rem 0;
    }

    strong {
      font-weight: 600;
      color: #2d3748;
    }

    .index-content ul {
      list-style: none;
      margin-left: 0;
    }

    .index-content ul li {
      padding: 0.5rem 0;
    }

    @media (max-width: 768px) {
      .sidebar {
        width: 100%;
        height: auto;
        position: relative;
      }

      .main-content {
        margin-left: 0;
        padding: 1.5rem;
      }
    }
  </style>
</head>
<body>
  ${navigation}
  <main class="main-content">
    ${content}
  </main>
</body>
</html>`;
}

async function writeHtmlFile(outputPath: string, html: string): Promise<void> {
  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(outputPath, html, 'utf-8');
}

async function main(): Promise<void> {
  const rootDir = resolve(process.cwd());
  const docsRoot = join(rootDir, 'docs');
  const outputRoot = join(rootDir, 'docs-html');

  console.log('📚 Generating HTML documentation...\n');
  console.log(`📂 Reading from: ${docsRoot}`);
  console.log(`📝 Writing to: ${outputRoot}\n`);

  // Scan all markdown files
  const files = await scanDocsDirectory(docsRoot, docsRoot);
  console.log(`Found ${files.length} documentation files\n`);

  // Organize by category
  const category = organizeByCategory(files);

  // Generate index page
  const indexHtml = generateIndexPage(category);
  await writeHtmlFile(join(outputRoot, 'index.html'), indexHtml);
  console.log('✅ Generated index.html');

  // Generate individual pages
  for (const file of files) {
    const htmlPath = file.relativePath.replace(/\.md$/, '.html');
    const outputPath = join(outputRoot, htmlPath);
    const nav = generateNavigation(category, htmlPath);
    const pageHtml = generatePageHtml(file.title, file.html, nav, htmlPath);

    await writeHtmlFile(outputPath, pageHtml);
    console.log(`✅ Generated ${htmlPath}`);
  }

  console.log(`\n🎉 Documentation generated successfully!`);
  console.log(`\n📖 Open ${join(outputRoot, 'index.html')} in your browser to view.`);
}

main().catch((error) => {
  console.error('❌ Error generating documentation:', error);
  process.exit(1);
});
