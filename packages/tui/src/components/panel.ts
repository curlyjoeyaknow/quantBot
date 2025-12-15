/**
 * Panel Component - Reusable panel wrapper
 */

/**
 * Panel options
 */
export interface PanelOptions {
  title?: string;
  content: string;
  height?: number;
  width?: number;
  borderStyle?: 'rounded' | 'bold' | 'double' | 'single';
}

/**
 * Create a panel (returns formatted string)
 */
export function createPanel(options: PanelOptions): string {
  const border =
    options.borderStyle === 'bold' ? '═' : options.borderStyle === 'double' ? '═' : '─';
  const lines: string[] = [];

  if (options.title) {
    lines.push(border.repeat(options.width || 80));
    lines.push(`  ${options.title}`);
    lines.push(border.repeat(options.width || 80));
  }

  // Split content into lines and limit height
  const contentLines = options.content.split('\n');
  const maxLines = options.height
    ? Math.min(options.height, contentLines.length)
    : contentLines.length;

  for (let i = 0; i < maxLines; i++) {
    lines.push(contentLines[i] || '');
  }

  if (options.height && contentLines.length > options.height) {
    lines.push(`... (${contentLines.length - options.height} more lines)`);
  }

  return lines.join('\n');
}
