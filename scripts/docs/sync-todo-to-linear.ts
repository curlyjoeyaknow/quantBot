#!/usr/bin/env tsx
/**
 * Sync TODO.md to Linear Issues
 *
 * Parses TODO.md and creates/updates Linear issues for incomplete tasks.
 * Requires Linear to be connected via GitKraken MCP.
 */

import { readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';

interface TodoItem {
  title: string;
  description: string;
  category: string;
  priority: 'high' | 'medium' | 'low';
  completed: boolean;
  subItems: TodoItem[];
}

function parseTodoMarkdown(content: string): TodoItem[] {
  const items: TodoItem[] = [];
  const lines = content.split('\n');

  let currentCategory = 'General';
  let currentPriority: 'high' | 'medium' | 'low' = 'medium';
  let currentSection = '';
  let stack: Array<{ item: TodoItem; level: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect category sections
    if (line.startsWith('### ')) {
      currentSection = line.replace(/^###\s+/, '').trim();

      // Determine priority from section
      if (currentSection.includes('High Priority') || currentSection.includes('Next Steps')) {
        currentPriority = 'high';
      } else if (currentSection.includes('Medium Priority')) {
        currentPriority = 'medium';
      } else if (currentSection.includes('Low Priority') || currentSection.includes('Backlog')) {
        currentPriority = 'low';
      }

      // Extract category name
      currentCategory = currentSection.replace(/^.*?[-–]\s*/, '').trim();
      if (!currentCategory || currentCategory === currentSection) {
        currentCategory = currentSection;
      }
    }

    // Detect todo items
    const todoMatch = line.match(/^(\s*)- \[([ xX])\] (.+)$/);
    if (todoMatch) {
      const indent = todoMatch[1].length;
      const completed = todoMatch[2].toLowerCase() === 'x';
      const title = todoMatch[3].trim();

      // Skip completed items for now (can be configured)
      if (completed) {
        continue;
      }

      const item: TodoItem = {
        title,
        description: extractDescription(lines, i),
        category: currentCategory,
        priority: currentPriority,
        completed: false,
        subItems: [],
      };

      // Find parent based on indent level
      while (stack.length > 0 && stack[stack.length - 1].level >= indent) {
        stack.pop();
      }

      if (stack.length === 0) {
        items.push(item);
        stack.push({ item, level: indent });
      } else {
        const parent = stack[stack.length - 1].item;
        parent.subItems.push(item);
        stack.push({ item, level: indent });
      }
    }
  }

  return items;
}

function extractDescription(lines: string[], startIndex: number): string {
  const description: string[] = [];
  let i = startIndex + 1;

  // Collect following lines until next todo or heading
  while (i < lines.length) {
    const line = lines[i];

    // Stop at next todo item or heading
    if (line.match(/^(\s*)- \[([ xX])\]/) || line.match(/^#{1,3}\s/)) {
      break;
    }

    // Collect non-empty lines
    const trimmed = line.trim();
    if (trimmed && !trimmed.match(/^[-*]\s*$/)) {
      description.push(trimmed);
    }

    i++;
  }

  return description.join('\n').trim();
}

function formatForLinear(item: TodoItem, indent = 0): string {
  const indentStr = '  '.repeat(indent);
  let result = `${indentStr}- **${item.title}**\n`;

  if (item.description) {
    result += `${indentStr}  ${item.description.split('\n').join(`\n${indentStr}  `)}\n`;
  }

  result += `${indentStr}  - Priority: ${item.priority}\n`;
  result += `${indentStr}  - Category: ${item.category}\n`;

  if (item.subItems.length > 0) {
    result += `${indentStr}  - Sub-tasks:\n`;
    for (const subItem of item.subItems) {
      result += formatForLinear(subItem, indent + 2);
    }
  }

  return result + '\n';
}

function generateLinearImportData(items: TodoItem[]): string {
  let output = '# Linear Issues Import Data\n\n';
  output += "Use this data with Linear's GraphQL API or import tool.\n\n";
  output += '## Issues to Create\n\n';

  for (const item of items) {
    output += formatForLinear(item);
  }

  return output;
}

async function main(): Promise<void> {
  const rootDir = resolve(process.cwd());
  const todoPath = join(rootDir, 'TODO.md');
  const outputPath = join(rootDir, 'docs', 'linear-import.md');

  console.log('📋 Parsing TODO.md...\n');

  try {
    const content = await readFile(todoPath, 'utf-8');
    const items = parseTodoMarkdown(content);

    console.log(`Found ${items.length} top-level incomplete TODO items\n`);

    // Display parsed items for review
    let totalCount = 0;
    function countItems(item: TodoItem): number {
      let count = 1;
      for (const subItem of item.subItems) {
        count += countItems(subItem);
      }
      return count;
    }

    for (const item of items) {
      const count = countItems(item);
      totalCount += count;
      console.log(`📌 [${item.priority.toUpperCase()}] ${item.title}`);
      console.log(`   Category: ${item.category}`);
      if (item.subItems.length > 0) {
        console.log(`   Sub-items: ${item.subItems.length}`);
      }
      console.log('');
    }

    console.log(`\n📊 Total items to create: ${totalCount}`);

    // Generate import data
    const importData = generateLinearImportData(items);
    await writeFile(outputPath, importData, 'utf-8');
    console.log(`\n✅ Generated import data: ${outputPath}`);

    console.log('\n📝 Next Steps:');
    console.log('   1. Connect Linear to GitKraken MCP (if not already connected)');
    console.log("   2. Use Linear's GraphQL API or CLI to create issues");
    console.log('   3. Or manually create issues in Linear using the data above');
    console.log('\n💡 Note: GitKraken MCP tools currently only support reading/comments,');
    console.log("   not creating issues. Use Linear's native API for creation.\n");
  } catch (error) {
    console.error('❌ Error reading TODO.md:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
