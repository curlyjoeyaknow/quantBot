/**
 * Monitoring Panel Screen
 */

import type { Screen } from '../types';
import { executeCLICommand } from '../core/cli-bridge';

/**
 * Monitoring panel screen implementation
 */
export class MonitoringPanelScreen implements Screen {
  name = 'monitoring-panel';
  private status: unknown = null;
  private alerts: unknown[] = [];

  async onMount(): Promise<void> {
    await this.refresh();
    // Set up periodic refresh
    setInterval(() => this.refresh(), 5000);
  }

  async refresh(): Promise<void> {
    try {
      const result = await executeCLICommand('monitoring', 'status', {});
      if (result.success) {
        this.status = result.data;
      }
    } catch (error) {
      // Handle error
    }
  }

  render(): void {
    console.clear();
    console.log('[bold]Monitoring Panel[/bold]');
    console.log('');

    if (this.status) {
      console.log('Status:', JSON.stringify(this.status, null, 2));
    } else {
      console.log('Loading status...');
    }

    console.log('');
    console.log('Alerts:');
    if (this.alerts.length === 0) {
      console.log('No active alerts');
    } else {
      for (const alert of this.alerts) {
        console.log(JSON.stringify(alert));
      }
    }
  }

  handleInput(key: string): void {
    if (key === 'escape') {
      // Navigate back
      return;
    }
  }
}

