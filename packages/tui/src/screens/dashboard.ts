/**
 * Dashboard Screen - Main TUI dashboard with blessed widgets
 */

import type { Screen } from '../types/index.js';
import { executeCLICommand } from '../core/cli-bridge.js';
import type { BlessedScreen } from '../core/blessed-screen.js';
import type { ScreenManager } from '../core/screen-manager.js';
import { logger } from '@quantbot/utils';

/**
 * Dashboard screen implementation
 */
export class DashboardScreen implements Screen {
  name = 'dashboard';
  private healthStatus: unknown = null;
  private quotas: unknown = null;
  private recentCalls: unknown[] = [];
  private blessedScreen: BlessedScreen | null = null;
  private screenManager: ScreenManager | null = null;
  private refreshInterval: NodeJS.Timeout | null = null;

  /**
   * Set blessed screen and screen manager
   */
  setBlessedScreen(blessedScreen: BlessedScreen, screenManager: ScreenManager): void {
    this.blessedScreen = blessedScreen;
    this.screenManager = screenManager;
  }

  async onMount(): Promise<void> {
    // Load initial data
    await this.refresh();

    // Set up auto-refresh every 5 seconds
    this.refreshInterval = setInterval(() => {
      this.refresh().catch((error) => {
        logger.error('Dashboard refresh error', error as Error);
      });
    }, 5000);
  }

  onUnmount(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  async refresh(): Promise<void> {
    try {
      // Fetch health status
      const healthResult = await executeCLICommand('observability', 'health', {});
      if (healthResult.success) {
        this.healthStatus = healthResult.data;
      }

      // Fetch quotas
      const quotasResult = await executeCLICommand('observability', 'quotas', {});
      if (quotasResult.success) {
        this.quotas = quotasResult.data;
      }
    } catch (error) {
      logger.error('Dashboard refresh error', error as Error);
    }

    // Re-render after data update
    this.render();
  }

  render(): void {
    if (!this.blessedScreen) {
      // Fallback to console if blessed screen not available
      this.renderConsole();
      return;
    }

    // Clear existing widgets
    this.blessedScreen.clear();

    // Header box
    const header = this.blessedScreen.createBox('header', {
      row: 0,
      col: 0,
      rowSpan: 1,
      colSpan: 12,
      label: ' QuantBot Dashboard ',
      content: 'Press Ctrl+P for command palette | Press Q to quit',
      style: {
        fg: 'white',
        bg: 'blue',
        border: { fg: 'cyan' },
      },
    });

    // Status panel (left side)
    const statusBox = this.blessedScreen.createBox('status', {
      row: 1,
      col: 0,
      rowSpan: 4,
      colSpan: 4,
      label: ' System Status ',
      content: this.renderStatusText(),
      style: {
        fg: 'green',
        border: { fg: 'green' },
      },
    });

    // Health gauge
    const healthGauge = this.blessedScreen.createGauge('health', {
      row: 1,
      col: 4,
      rowSpan: 2,
      colSpan: 2,
      label: ' Health ',
      percent: this.healthStatus ? 100 : 50,
    });

    // Quota gauge
    const quotaGauge = this.blessedScreen.createGauge('quota', {
      row: 3,
      col: 4,
      rowSpan: 2,
      colSpan: 2,
      label: ' Quota Usage ',
      percent: this.quotas ? 75 : 0,
    });

    // Recent calls table
    const callsTableData = this.renderCallsTable();
    const callsTable = this.blessedScreen.createTable('calls', {
      row: 1,
      col: 6,
      rowSpan: 4,
      colSpan: 6,
      label: ' Recent Calls ',
      data: callsTableData.length > 0 ? callsTableData : [['No recent calls', '', '', '']],
      keys: true,
    });

    // Quick actions box
    const actionsBox = this.blessedScreen.createBox('actions', {
      row: 5,
      col: 0,
      rowSpan: 2,
      colSpan: 12,
      label: ' Quick Actions ',
      content: this.renderQuickActions(),
      style: {
        fg: 'yellow',
        border: { fg: 'yellow' },
      },
    });

    // Log/Info panel (bottom) - use a simple box instead of log widget to avoid parent issues
    const logBox = this.blessedScreen.createBox('log', {
      row: 7,
      col: 0,
      rowSpan: 5,
      colSpan: 12,
      label: ' System Log ',
      content: [
        'Dashboard initialized',
        `Health: ${this.healthStatus ? 'OK' : 'Loading...'}`,
        `Quotas: ${this.quotas ? 'OK' : 'Loading...'}`,
        '',
        'Use arrow keys to navigate, Q to quit',
      ].join('\n'),
      style: {
        fg: 'green',
        border: { fg: 'green' },
      },
    });

    // Render
    this.blessedScreen.render();
  }

  private renderConsole(): void {
    // Fallback console rendering
    console.clear();
    console.log('═══════════════════════════════════════════════════════');
    console.log('  QuantBot Dashboard          Press Ctrl+P for command palette');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log(this.renderStatusText());
    console.log('');
    console.log(this.renderRecentCalls());
    console.log('');
    console.log(this.renderQuickActions());
  }

  private renderStatusText(): string {
    const lines: string[] = [];
    lines.push('System Status');
    lines.push('');
    lines.push(`Health: ${this.healthStatus ? '✅ OK' : '⏳ Loading...'}`);
    lines.push(`Quotas: ${this.quotas ? '✅ OK' : '⏳ Loading...'}`);
    lines.push('');
    lines.push('Last Update: ' + new Date().toLocaleTimeString());
    return lines.join('\n');
  }

  private renderCallsTable(): string[][] {
    const headers = ['Time', 'Token', 'Action', 'Status'];
    const rows: string[][] = [headers];

    if (this.recentCalls.length === 0) {
      rows.push(['No recent calls', '', '', '']);
    } else {
      for (const call of this.recentCalls.slice(0, 10)) {
        const callObj = call as Record<string, unknown>;
        rows.push([
          callObj.timestamp ? new Date(callObj.timestamp as number).toLocaleTimeString() : 'N/A',
          String(callObj.token || 'N/A').substring(0, 12),
          String(callObj.action || 'N/A'),
          String(callObj.status || 'N/A'),
        ]);
      }
    }

    return rows;
  }

  private renderRecentCalls(): string {
    const lines: string[] = [];
    lines.push('[bold]Recent Calls[/bold]');
    lines.push('');

    if (this.recentCalls.length === 0) {
      lines.push('No recent calls');
    } else {
      for (const call of this.recentCalls.slice(0, 10)) {
        lines.push(`• ${JSON.stringify(call)}`);
      }
    }

    return lines.join('\n');
  }

  private renderQuickActions(): string {
    const lines: string[] = [];
    lines.push('[1] Run Simulation  [2] View OHLCV  [3] Start Monitor  [4] Analytics');
    lines.push('[Ctrl+P] Command Palette  [Q] Quit  [R] Refresh');
    return lines.join('\n');
  }

  handleInput(key: string): void {
    switch (key.toLowerCase()) {
      case '1':
        // Navigate to simulation runner
        // TODO: Implement navigation
        break;
      case '2':
        // Navigate to OHLCV viewer
        // TODO: Implement navigation
        break;
      case '3':
        // Navigate to monitoring panel
        // TODO: Implement navigation
        break;
      case '4':
        // Navigate to analytics viewer
        // TODO: Implement navigation
        break;
      case 'r':
        // Refresh
        this.refresh().catch((error) => {
          logger.error('Refresh error', error as Error);
        });
        break;
      case 'ctrl+p':
        // Open command palette
        // TODO: Implement command palette
        break;
      case 'q':
      case 'ctrl+q':
        // Quit handled by app
        break;
    }
  }
}
