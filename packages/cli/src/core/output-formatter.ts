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
 * Convert a value to a displayable string, handling nested objects
 */
function valueToString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  // Handle Date objects explicitly
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object') {
    // Convert objects/arrays to compact JSON
    // Use a replacer to handle Date objects and other special cases
    return JSON.stringify(value, (key, val) => {
      if (val instanceof Date) {
        return val.toISOString();
      }
      return val;
    });
  }
  return String(value);
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
        return valueToString(value).length;
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
        return valueToString(value).padEnd(widths[col]!);
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
      const str = valueToString(value);
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
 * Format lab simulation results with compact summary
 */
function formatLabResults(data: unknown, format: OutputFormat): string | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }

  const obj = data as Record<string, unknown>;

  // Check if this looks like a lab result
  if ('callsSimulated' in obj && 'summary' in obj && 'results' in obj) {
    const summary = obj.summary as Record<string, unknown>;
    const results = obj.results as Array<Record<string, unknown>>;

    if (format === 'table') {
      // Show compact summary for table format
      const lines: string[] = [];
      lines.push('=== Lab Simulation Summary ===');
      lines.push('');
      lines.push(`Calls Simulated: ${obj.callsSimulated}`);
      lines.push(
        `Calls Succeeded: ${obj.callsSucceeded} (${(((obj.callsSucceeded as number) / (obj.callsSimulated as number)) * 100).toFixed(1)}%)`
      );
      lines.push(
        `Calls Failed: ${obj.callsFailed} (${(((obj.callsFailed as number) / (obj.callsSimulated as number)) * 100).toFixed(1)}%)`
      );
      lines.push('');
      lines.push('=== Performance Metrics ===');
      if (summary.avgPnl !== undefined) {
        lines.push(`Average PnL: ${(summary.avgPnl as number).toFixed(4)}x`);
      }
      if (summary.minPnl !== undefined) {
        lines.push(`Min PnL: ${(summary.minPnl as number).toFixed(4)}x`);
      }
      if (summary.maxPnl !== undefined) {
        lines.push(`Max PnL: ${(summary.maxPnl as number).toFixed(4)}x`);
      }
      if (summary.winRate !== undefined) {
        lines.push(`Win Rate: ${((summary.winRate as number) * 100).toFixed(1)}%`);
      }
      if (summary.totalTrades !== undefined) {
        lines.push(`Total Trades: ${summary.totalTrades}`);
      }
      if (summary.successRate !== undefined) {
        lines.push(`Success Rate: ${((summary.successRate as number) * 100).toFixed(1)}%`);
      }
      if (summary.profitableCalls !== undefined) {
        lines.push(`Profitable Calls: ${summary.profitableCalls}`);
      }
      if (summary.losingCalls !== undefined) {
        lines.push(`Losing Calls: ${summary.losingCalls}`);
      }
      lines.push('');
      lines.push(`=== Top 10 Results (by PnL) ===`);

      // Show top 10 results sorted by PnL
      const successfulResults = results
        .filter((r) => r.ok && r.pnlMultiplier !== undefined)
        .sort((a, b) => ((b.pnlMultiplier as number) ?? 0) - ((a.pnlMultiplier as number) ?? 0))
        .slice(0, 10);

      if (successfulResults.length > 0) {
        lines.push('Mint (truncated) | PnL Multiplier | Trades');
        lines.push('-----------------|----------------|--------');
        for (const result of successfulResults) {
          const mint = (result.mint as string) || '';
          const truncatedMint = mint.length > 20 ? mint.slice(0, 17) + '...' : mint.padEnd(20);
          const pnl = (result.pnlMultiplier as number) ?? 0;
          const trades = (result.trades as number) ?? 0;
          lines.push(`${truncatedMint} | ${pnl.toFixed(4).padStart(14)} | ${trades}`);
        }
      } else {
        lines.push('No successful results to display');
      }

      return lines.join('\n');
    }

    // For JSON/CSV, return null to use default formatting
    return null;
  }

  // Not a lab result
  return null;
}

/**
 * Format output based on format type
 */
export function formatOutput(data: unknown, format: OutputFormat = 'table'): string {
  // Try lab-specific formatting first
  const labFormatted = formatLabResults(data, format);
  if (labFormatted !== null) {
    return labFormatted;
  }

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

// createProgressIndicator removed - use progress-indicator.ts instead
