/**
 * Output Formatter - JSON, table, CSV formats
 */

import type { OutputFormat } from '../types/index.js';

/**
 * Format output as JSON
 */
export function formatJSON(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Format output as a simple table
 */
export function formatTable(data: unknown[], columns?: string[]): string {
  if (!Array.isArray(data) || data.length === 0) {
    return 'No data to display';
  }

  // Auto-detect columns if not provided
  const detectedColumns =
    columns ??
    (data.length > 0 && typeof data[0] === 'object' && data[0] !== null
      ? Object.keys(data[0] as Record<string, unknown>)
      : []);

  if (detectedColumns.length === 0) {
    return formatJSON(data);
  }

  // Calculate column widths
  const widths: Record<string, number> = {};
  for (const col of detectedColumns) {
    widths[col] = Math.max(
      col.length,
      ...data.map((row) => {
        const value = (row as Record<string, unknown>)[col];
        return value ? String(value).length : 0;
      })
    );
  }

  // Build table
  const lines: string[] = [];

  // Header
  const header = detectedColumns.map((col) => col.padEnd(widths[col]!)).join(' | ');
  lines.push(header);
  lines.push(detectedColumns.map((col) => '-'.repeat(widths[col]!)).join('-|-'));

  // Rows
  for (const row of data) {
    const rowData = detectedColumns
      .map((col) => {
        const value = (row as Record<string, unknown>)[col];
        return String(value ?? '').padEnd(widths[col]!);
      })
      .join(' | ');
    lines.push(rowData);
  }

  return lines.join('\n');
}

/**
 * Format output as CSV
 */
export function formatCSV(data: unknown[], columns?: string[]): string {
  if (!Array.isArray(data) || data.length === 0) {
    return '';
  }

  // Auto-detect columns if not provided
  const detectedColumns =
    columns ??
    (data.length > 0 && typeof data[0] === 'object' && data[0] !== null
      ? Object.keys(data[0] as Record<string, unknown>)
      : []);

  if (detectedColumns.length === 0) {
    return '';
  }

  const lines: string[] = [];

  // Header
  lines.push(detectedColumns.join(','));

  // Rows
  for (const row of data) {
    const values = detectedColumns.map((col) => {
      const value = (row as Record<string, unknown>)[col];
      // Escape CSV values
      if (value === null || value === undefined) {
        return '';
      }
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    });
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

/**
 * Format output based on format type
 */
export function formatOutput(data: unknown, format: OutputFormat = 'table'): string {
  // Handle arrays
  if (Array.isArray(data)) {
    switch (format) {
      case 'json':
        return formatJSON(data);
      case 'csv':
        return formatCSV(data);
      case 'table':
        return formatTable(data);
      default:
        return formatJSON(data);
    }
  }

  // Handle objects
  if (typeof data === 'object' && data !== null) {
    switch (format) {
      case 'json':
        return formatJSON(data);
      case 'csv':
        // Convert single object to array
        return formatCSV([data]);
      case 'table':
        // Convert single object to array
        return formatTable([data]);
      default:
        return formatJSON(data);
    }
  }

  // Handle primitives
  return String(data);
}

/**
 * Create a progress indicator (simple text-based)
 */
export function createProgressIndicator(current: number, total: number, label?: string): string {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  const barLength = 20;
  const filled = Math.round((percent / 100) * barLength);
  const bar = '='.repeat(filled) + '-'.repeat(barLength - filled);

  const labelText = label ? `${label}: ` : '';
  return `${labelText}[${bar}] ${percent}% (${current}/${total})`;
}
