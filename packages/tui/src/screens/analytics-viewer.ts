/**
 * Analytics Viewer Screen
 */

import type { Screen } from '../types';
import { executeCLICommand } from '../core/cli-bridge';

/**
 * Analytics viewer screen implementation
 */
export class AnalyticsViewerScreen implements Screen {
  name = 'analytics-viewer';
  private analytics: unknown = null;
  private caller = '';
  private fromDate = '';
  private toDate = '';

  async onMount(): Promise<void> {
    if (this.caller && this.fromDate && this.toDate) {
      await this.loadAnalytics();
    }
  }

  async loadAnalytics(): Promise<void> {
    try {
      const result = await executeCLICommand('analytics', 'analyze', {
        caller: this.caller,
        from: this.fromDate,
        to: this.toDate,
      });

      if (result.success) {
        this.analytics = result.data;
      }
    } catch (error) {
      // Handle error
    }
  }

  render(): void {
    console.clear();
    console.log('[bold]Analytics Viewer[/bold]');
    console.log('');

    if (this.analytics) {
      console.log(JSON.stringify(this.analytics, null, 2));
    } else {
      console.log('No analytics data loaded');
    }
  }

  handleInput(key: string): void {
    if (key === 'escape') {
      // Navigate back
      return;
    }
  }
}
