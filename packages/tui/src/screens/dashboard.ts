/**
 * Dashboard Screen - Main TUI dashboard
 */

// Using simple console output for now - can be enhanced with blessed later
import type { Screen } from '../types';
import { executeCLICommand } from '../core/cli-bridge';

/**
 * Dashboard screen implementation
 */
export class DashboardScreen implements Screen {
  name = 'dashboard';
  private healthStatus: unknown = null;
  private quotas: unknown = null;
  private recentCalls: unknown[] = [];

  async onMount(): Promise<void> {
    // Load initial data
    await this.refresh();
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
      // Ignore errors for now
    }
  }

  render(): void {
    // Clear screen
    console.clear();

    // Header
    console.log('═══════════════════════════════════════════════════════');
    console.log('  QuantBot Dashboard          Press Ctrl+P for command palette');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    // Status
    console.log(this.renderStatus());
    console.log('');

    // Recent calls
    console.log(this.renderRecentCalls());
    console.log('');

    // Quick actions
    console.log(this.renderQuickActions());
  }

  private renderStatus(): string {
    const lines: string[] = [];
    lines.push('[bold]System Status[/bold]');
    lines.push('');

    if (this.healthStatus) {
      lines.push('✅ Health: OK');
    } else {
      lines.push('⏳ Health: Loading...');
    }

    if (this.quotas) {
      lines.push('✅ Quotas: OK');
    } else {
      lines.push('⏳ Quotas: Loading...');
    }

    return lines.join('\n');
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
    lines.push('[bold]Quick Actions[/bold]');
    lines.push('');
    lines.push('[1] Run Simulation  [2] View OHLCV  [3] Start Monitor  [4] Analytics');
    lines.push('[Ctrl+P] Command Palette  [Ctrl+Q] Quit');

    return lines.join('\n');
  }

  handleInput(key: string): void {
    switch (key) {
      case '1':
        // Navigate to simulation runner
        break;
      case '2':
        // Navigate to OHLCV viewer
        break;
      case '3':
        // Navigate to monitoring panel
        break;
      case '4':
        // Navigate to analytics viewer
        break;
      case 'ctrl+p':
        // Open command palette
        break;
      case 'ctrl+q':
        // Quit
        break;
    }
  }
}
