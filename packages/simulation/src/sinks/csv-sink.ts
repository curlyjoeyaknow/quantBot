/**
 * CSV Sink
 * ========
 * Output simulation results to CSV file.
 *
 * @deprecated This sink has been moved to @quantbot/workflows.
 * Import from @quantbot/workflows/sinks/csv-sink instead.
 * This file will be removed in a future version.
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { SimulationRunContext } from '../core';
import type { ResultSink, BaseSinkOptions } from './base';

/**
 * CSV sink options
 */
export interface CsvSinkOptions extends BaseSinkOptions {
  /** Output file path */
  path: string;
  /** Include event details */
  includeEvents?: boolean;
  /** Append to existing file */
  append?: boolean;
}

/**
 * CSV result sink
 */
export class CsvSink implements ResultSink {
  readonly name = 'csv';
  private readonly filePath: string;
  private readonly includeEvents: boolean;
  private readonly append: boolean;
  private initialized = false;

  constructor(options: CsvSinkOptions) {
    this.filePath = path.isAbsolute(options.path)
      ? options.path
      : path.join(process.cwd(), options.path);
    this.includeEvents = options.includeEvents ?? false;
    this.append = options.append ?? false;
  }

  async handle(context: SimulationRunContext): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    // Write header if not initialized
    if (!this.initialized || !this.append) {
      const header = this.getHeader();
      await fs.writeFile(this.filePath, header + '\n', 'utf-8');
      this.initialized = true;
    }

    // Write row
    const row = this.formatRow(context);
    await fs.appendFile(this.filePath, row + '\n', 'utf-8');
  }

  private getHeader(): string {
    return [
      'scenario',
      'mint',
      'token_symbol',
      'token_name',
      'chain',
      'start_time',
      'end_time',
      'entry_price',
      'final_price',
      'final_pnl',
      'pnl_percent',
      'total_candles',
      'events_count',
    ].join(',');
  }

  private formatRow(context: SimulationRunContext): string {
    const tokenSymbol = (context.metadata?.symbol as string) || '';
    const tokenName = (context.metadata?.name as string) || '';
    const pnlPercent = (context.result.finalPnl - 1) * 100;

    return [
      context.scenario.name,
      context.target.mint,
      tokenSymbol,
      tokenName,
      context.target.chain,
      context.target.startTime.toISO(),
      context.target.endTime.toISO(),
      context.result.entryPrice.toFixed(8),
      context.result.finalPrice.toFixed(8),
      context.result.finalPnl.toFixed(6),
      pnlPercent.toFixed(2),
      context.result.totalCandles.toString(),
      context.result.events.length.toString(),
    ].join(',');
  }
}
