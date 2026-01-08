/**
 * Console Sink
 * ============
 * Output simulation results to console.
 */

import type { SimulationRunContext } from '../core/index.js';
import type { ResultSink, BaseSinkOptions } from './base.js';

/**
 * Console sink options
 */
export interface ConsoleSinkOptions extends BaseSinkOptions {
  /** Detail level */
  detail?: 'summary' | 'detailed';
  /** Prefix for output */
  prefix?: string;
}

/**
 * Console result sink
 */
export class ConsoleSink implements ResultSink {
  readonly name = 'console';
  private readonly detail: 'summary' | 'detailed';
  private readonly prefix: string;

  constructor(options: ConsoleSinkOptions = {}) {
    this.detail = options.detail ?? 'summary';
    this.prefix = options.prefix ?? '[simulation]';
  }

  async handle(context: SimulationRunContext): Promise<void> {
    const metadata = context.target.metadata as { symbol?: string; name?: string } | undefined;
    const tokenSymbol = (metadata?.symbol as string) || context.target.mint;
    const tokenName = (metadata?.name as string) || undefined;
    const displayName = tokenName ? `${tokenName} (${tokenSymbol})` : tokenSymbol;

    const pnlPercent = (context.result.finalPnl - 1) * 100;
    const pnlSign = pnlPercent >= 0 ? '+' : '';

    if (this.detail === 'detailed') {
      console.log(this.prefix, {
        scenario: context.scenario.name,
        mint: context.target.mint,
        token: displayName,
        chain: context.target.chain,
        finalPnl: `${pnlSign}${pnlPercent.toFixed(2)}%`,
        entryPrice: context.result.entryPrice,
        finalPrice: context.result.finalPrice,
        events: context.result.events.length,
        candles: context.result.totalCandles,
      });
    } else {
      console.log(
        `${this.prefix} ${context.scenario.name} ${displayName} ${pnlSign}${pnlPercent.toFixed(1)}%`
      );
    }
  }
}
