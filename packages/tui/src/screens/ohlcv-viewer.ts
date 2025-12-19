/**
 * OHLCV Viewer Screen
 */

import type { Screen } from '../types/index.js';
import { executeCLICommand } from '../core/cli-bridge.js';

/**
 * OHLCV viewer screen implementation
 */
export class OhlcvViewerScreen implements Screen {
  name = 'ohlcv-viewer';
  private candles: unknown[] = [];
  private mintAddress = '';
  private fromDate = '';
  private toDate = '';

  async onMount(): Promise<void> {
    // Load initial data if parameters provided
    if (this.mintAddress && this.fromDate && this.toDate) {
      await this.loadCandles();
    }
  }

  async loadCandles(): Promise<void> {
    try {
      const result = await executeCLICommand('ohlcv', 'query', {
        mint: this.mintAddress,
        from: this.fromDate,
        to: this.toDate,
        format: 'json',
      });

      if (result.success && Array.isArray(result.data)) {
        this.candles = result.data;
      }
    } catch (error) {
      // Handle error
    }
  }

  render(): void {
    console.clear();
    console.log('[bold]OHLCV Viewer[/bold]');
    console.log('');

    if (this.candles.length === 0) {
      console.log('No candles loaded. Use filters to load data.');
    } else {
      // Render candle chart (simplified)
      console.log(`Loaded ${this.candles.length} candles`);
      console.log('');
      console.log('Candles:');
      for (const candle of this.candles.slice(0, 20)) {
        console.log(JSON.stringify(candle));
      }
    }
  }

  handleInput(key: string): void {
    // Handle input for filtering/navigation
    if (key === 'escape') {
      // Navigate back
      return;
    }
  }
}
