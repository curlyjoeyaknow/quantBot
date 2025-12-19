/**
 * Blessed Screen Manager - Wraps blessed screen for TUI rendering
 */

import blessed, { type Widgets } from 'blessed';
import contrib from 'blessed-contrib';
import type { Screen as TuiScreen } from '../types/index.js';

/**
 * Blessed screen wrapper
 */
export class BlessedScreen {
  private screen: Widgets.Screen;
  private grid: contrib.grid;
  private widgets: Map<string, Widgets.Node> = new Map();

  constructor() {
    // Create blessed screen
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'QuantBot TUI',
      fullUnicode: true,
      cursor: {
        artificial: true,
        shape: 'line',
        blink: true,
        color: 'white',
      },
    });

    // Create grid layout
    this.grid = new contrib.grid({
      rows: 12,
      cols: 12,
      screen: this.screen,
    });

    // Handle exit
    this.screen.key(['escape', 'q', 'C-c'], () => {
      this.screen.destroy();
      process.exit(0);
    });
  }

  /**
   * Get the blessed screen instance
   */
  getScreen(): Widgets.Screen {
    return this.screen;
  }

  /**
   * Get the grid layout
   */
  getGrid(): contrib.grid {
    return this.grid;
  }

  /**
   * Create a box widget
   */
  createBox(
    name: string,
    options: {
      row: number;
      col: number;
      rowSpan?: number;
      colSpan?: number;
      label?: string;
      content?: string;
      border?: { type: 'line' | 'bg' };
      style?: { fg?: string; bg?: string; border?: { fg?: string } };
    }
  ): Widgets.BoxElement {
    const box = this.grid.set(
      options.row,
      options.col,
      options.rowSpan || 1,
      options.colSpan || 1,
      blessed.box,
      {
        label: options.label || name,
        content: options.content || '',
        border: options.border || { type: 'line' },
        style: options.style || {},
        scrollable: true,
        alwaysScroll: true,
        keys: true,
        vi: true,
      }
    );

    this.widgets.set(name, box);
    return box;
  }

  /**
   * Create a table widget
   */
  createTable(
    name: string,
    options: {
      row: number;
      col: number;
      rowSpan?: number;
      colSpan?: number;
      label?: string;
      data?: string[][];
      keys?: boolean;
    }
  ): ReturnType<typeof contrib.table> {
    const table = this.grid.set(
      options.row,
      options.col,
      options.rowSpan || 1,
      options.colSpan || 1,
      contrib.table,
      {
        label: options.label || name,
        keys: options.keys !== false,
        fg: 'white',
        selectedFg: 'black',
        selectedBg: 'yellow',
        columnSpacing: 2,
        columnWidth: [16, 16, 16, 16],
      }
    );

    if (options.data) {
      // blessed-contrib table.setData expects { headers: string[], data: string[][] }
      if (Array.isArray(options.data) && options.data.length > 0) {
        // First row is headers, rest is data
        const firstRow = options.data[0];
        if (Array.isArray(firstRow)) {
          const headers = firstRow.map((cell) => String(cell ?? ''));
          const dataRows = options.data.slice(1).map((row) => {
            if (Array.isArray(row)) {
              return row.map((cell) => String(cell ?? ''));
            }
            return [String(row ?? '')];
          });
          // blessed-contrib expects { headers, data } format
          (table as { setData: (data: { headers: string[]; data: string[][] }) => void }).setData({
            headers,
            data: dataRows.length > 0 ? dataRows : [['No data']],
          });
        }
      }
    }

    this.widgets.set(name, table);
    return table;
  }

  /**
   * Create a line chart
   */
  createLineChart(
    name: string,
    options: {
      row: number;
      col: number;
      rowSpan?: number;
      colSpan?: number;
      label?: string;
      data?: Array<{ title: string; x: string[]; y: number[]; style?: { line: string } }>;
    }
  ): ReturnType<typeof contrib.line> {
    const chart = this.grid.set(
      options.row,
      options.col,
      options.rowSpan || 1,
      options.colSpan || 1,
      contrib.line,
      {
        label: options.label || name,
        style: {
          line: 'yellow',
          text: 'green',
          baseline: 'white',
        },
        wholeNumbersOnly: false,
        showLegend: true,
        legend: { width: 12 },
      }
    );

    if (options.data) {
      chart.setData(options.data);
    }

    this.widgets.set(name, chart);
    return chart;
  }

  /**
   * Create a bar chart
   */
  createBarChart(
    name: string,
    options: {
      row: number;
      col: number;
      rowSpan?: number;
      colSpan?: number;
      label?: string;
      data?: { titles: string[]; data: number[] };
    }
  ): ReturnType<typeof contrib.bar> {
    const chart = this.grid.set(
      options.row,
      options.col,
      options.rowSpan || 1,
      options.colSpan || 1,
      contrib.bar,
      {
        label: options.label || name,
        barWidth: 4,
        barSpacing: 6,
        xOffset: 0,
        maxHeight: 9,
      }
    );

    if (options.data) {
      chart.setData(options.data);
    }

    this.widgets.set(name, chart);
    return chart;
  }

  /**
   * Create a gauge
   */
  createGauge(
    name: string,
    options: {
      row: number;
      col: number;
      rowSpan?: number;
      colSpan?: number;
      label?: string;
      percent?: number;
    }
  ): ReturnType<typeof contrib.gauge> {
    const gauge = this.grid.set(
      options.row,
      options.col,
      options.rowSpan || 1,
      options.colSpan || 1,
      contrib.gauge,
      {
        label: options.label || name,
        stroke: 'green',
        fill: 'white',
        percent: options.percent || 0,
      }
    );

    this.widgets.set(name, gauge);
    return gauge;
  }

  /**
   * Create a log widget
   */
  createLog(
    name: string,
    options: {
      row: number;
      col: number;
      rowSpan?: number;
      colSpan?: number;
      label?: string;
    }
  ): Widgets.Log {
    const log = this.grid.set(
      options.row,
      options.col,
      options.rowSpan || 1,
      options.colSpan || 1,
      blessed.log,
      {
        label: options.label || name,
        keys: true,
        vi: true,
        scrollable: false, // Disable auto-scroll to avoid parent access issues
        alwaysScroll: false,
        scrollbar: {
          ch: ' ',
          inverse: true,
        },
        style: {
          fg: 'green',
        },
      }
    );

    this.widgets.set(name, log);
    return log;
  }

  /**
   * Get a widget by name
   */
  getWidget(name: string): Widgets.Node | undefined {
    return this.widgets.get(name);
  }

  /**
   * Remove a widget
   */
  removeWidget(name: string): void {
    const widget = this.widgets.get(name);
    if (widget) {
      widget.detach();
      this.widgets.delete(name);
    }
  }

  /**
   * Clear all widgets
   */
  clear(): void {
    for (const [name] of this.widgets) {
      this.removeWidget(name);
    }
  }

  /**
   * Render the screen
   */
  render(): void {
    this.screen.render();
  }

  /**
   * Destroy the screen
   */
  destroy(): void {
    this.clear();
    this.screen.destroy();
  }

  /**
   * Set key handler
   */
  onKey(
    keys: string | string[],
    handler: (ch: string, key: { name: string; full: string; ctrl?: boolean; shift?: boolean }) => void
  ): void {
    this.screen.key(keys, handler);
  }

  /**
   * Handle input from TUI screen
   */
  handleTuiScreenInput(screen: TuiScreen, key: string): void {
    // Convert blessed key format to our format
    const normalizedKey = this.normalizeKey(key);
    screen.handleInput(normalizedKey);
  }

  /**
   * Handle blessed keypress event and convert to TUI format
   */
  handleBlessedKeypress(
    screen: TuiScreen,
    ch: string | undefined,
    key: { name?: string; full?: string; ctrl?: boolean; shift?: boolean }
  ): void {
    let normalizedKey = '';

    if (key.ctrl && ch) {
      normalizedKey = `ctrl+${ch.toLowerCase()}`;
    } else if (key.name) {
      normalizedKey = key.name.toLowerCase();
      if (key.ctrl) {
        normalizedKey = `ctrl+${normalizedKey}`;
      }
    } else if (ch) {
      normalizedKey = ch.toLowerCase();
    } else {
      return; // Unknown key
    }

    screen.handleInput(normalizedKey);
  }

  /**
   * Normalize key string for TUI screens
   */
  private normalizeKey(key: string): string {
    // Handle special keys
    if (key === '\x1b') return 'escape';
    if (key === '\x03') return 'ctrl+c';
    if (key === '\x10') return 'ctrl+p';
    if (key === '\x11') return 'ctrl+q';

    // Handle arrow keys (basic)
    if (key.startsWith('\x1b[')) {
      if (key === '\x1b[A') return 'up';
      if (key === '\x1b[B') return 'down';
      if (key === '\x1b[C') return 'right';
      if (key === '\x1b[D') return 'left';
    }

    return key.toLowerCase();
  }
}

