/**
 * Table Component - Tables with formatting
 */

import Table from 'cli-table3';

/**
 * Table component options
 */
export interface TableOptions {
  title?: string;
  columns: Array<{ header: string; key: string; width?: number }>;
  data: unknown[];
  sortable?: boolean;
  pagination?: boolean;
  pageSize?: number;
}

/**
 * Create a table component
 */
export function createTable(options: TableOptions): string {
  const table = new Table({
    head: options.columns.map((col) => col.header),
    colWidths: options.columns.map((col) => col.width || 20),
  });

  // Add rows
  for (const row of options.data) {
    const values = options.columns.map((col) => {
      const value = (row as Record<string, unknown>)[col.key];
      return value !== null && value !== undefined ? String(value) : '';
    });
    table.push(values);
  }

  return table.toString();
}
