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
  private healthError: string | null = null;
  private quotasError: string | null = null;

  /**
   * Set blessed screen and screen manager
   */
  setBlessedScreen(blessedScreen: BlessedScreen, screenManager: ScreenManager): void {
    this.blessedScreen = blessedScreen;
    this.screenManager = screenManager;
  }

  async onMount(): Promise<void> {
    // Render immediately with loading state
    this.render();

    // Load initial data asynchronously (non-blocking)
    this.refresh().catch((error) => {
      logger.error('Dashboard initial refresh error', error as Error);
    });

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
    // Reset errors
    this.healthError = null;
    this.quotasError = null;

    try {
      // Fetch health status with timeout
      try {
        const healthResult = await Promise.race([
          executeCLICommand('observability', 'health', {}),
          new Promise<{ success: false; error: string }>((_, reject) =>
            setTimeout(() => reject(new Error('Health check timeout')), 5000)
          ),
        ]);
        if (healthResult.success) {
          this.healthStatus = healthResult.data;
          this.healthError = null;
        } else {
          this.healthError = healthResult.error || 'Unknown error';
          this.healthStatus = null;
        }
      } catch (error) {
        this.healthError = error instanceof Error ? error.message : 'Failed to fetch health';
        this.healthStatus = null;
        logger.error('Health check failed', error as Error);
      }

      // Fetch quotas with timeout
      try {
        const quotasResult = await Promise.race([
          executeCLICommand('observability', 'quotas', {}),
          new Promise<{ success: false; error: string }>((_, reject) =>
            setTimeout(() => reject(new Error('Quotas check timeout')), 5000)
          ),
        ]);
        if (quotasResult.success) {
          this.quotas = quotasResult.data;
          this.quotasError = null;
        } else {
          this.quotasError = quotasResult.error || 'Unknown error';
          this.quotas = null;
        }
      } catch (error) {
        this.quotasError = error instanceof Error ? error.message : 'Failed to fetch quotas';
        this.quotas = null;
        logger.error('Quotas check failed', error as Error);
      }
    } catch (error) {
      logger.error('Dashboard refresh error', error as Error);
    }

    // Always re-render after data update (even if failed)
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
    const _header = this.blessedScreen.createBox('header', {
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
    const _statusBox = this.blessedScreen.createBox('status', {
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
    const _healthGauge = this.blessedScreen.createGauge('health', {
      row: 1,
      col: 4,
      rowSpan: 2,
      colSpan: 2,
      label: ' Health ',
      percent: this.healthStatus ? 100 : 50,
    });

    // Quota gauge
    const _quotaGauge = this.blessedScreen.createGauge('quota', {
      row: 3,
      col: 4,
      rowSpan: 2,
      colSpan: 2,
      label: ' Quota Usage ',
      percent: this.quotas ? 75 : 0,
    });

    // Recent calls table
    const callsTableData = this.renderCallsTable();
    const _callsTable = this.blessedScreen.createTable('calls', {
      row: 1,
      col: 6,
      rowSpan: 4,
      colSpan: 6,
      label: ' Recent Calls ',
      data: callsTableData.length > 0 ? callsTableData : [['No recent calls', '', '', '']],
      keys: true,
    });

    // Quick actions box
    const _actionsBox = this.blessedScreen.createBox('actions', {
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
    const _logBox = this.blessedScreen.createBox('log', {
      row: 7,
      col: 0,
      rowSpan: 5,
      colSpan: 12,
      label: ' System Log ',
      content: [
        'Dashboard initialized',
        this.healthError
          ? `Health: ❌ Error - ${this.healthError}`
          : this.healthStatus
            ? 'Health: ✅ OK'
            : 'Health: ⏳ Loading...',
        this.quotasError
          ? `Quotas: ❌ Error - ${this.quotasError}`
          : this.quotas
            ? 'Quotas: ✅ OK'
            : 'Quotas: ⏳ Loading...',
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
    if (this.healthError) {
      lines.push(`Health: ❌ Error`);
      lines.push(`  ${this.healthError.substring(0, 40)}`);
    } else {
      lines.push(`Health: ${this.healthStatus ? '✅ OK' : '⏳ Loading...'}`);
    }
    if (this.quotasError) {
      lines.push(`Quotas: ❌ Error`);
      lines.push(`  ${this.quotasError.substring(0, 40)}`);
    } else {
      lines.push(`Quotas: ${this.quotas ? '✅ OK' : '⏳ Loading...'}`);
    }
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
