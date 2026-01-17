/**
 * Strategy Comparison Web UI Handler
 * 
 * Launches a web UI for comparing strategies with:
 * - TradingView charting for individual trade events
 * - Equity curve comparison between all strategies
 * - In-depth equity curve for individual runs
 */

import type { CommandContext } from '../../core/command-context.js';
import type { StrategyCompareWebArgs } from '../../command-defs/strategy.js';
import { startServer } from '@quantbot/lab';

export async function compareWebHandler(
  args: StrategyCompareWebArgs,
  _ctx: CommandContext
): Promise<{ message: string; url: string; port: number }> {
  const port = args.port;
  const host = args.host;

  // Start the lab server with strategy comparison enabled
  await startServer(port);

  const url = `http://${host}:${port}/strategy-compare`;

  return {
    message: `Strategy comparison web UI started`,
    url,
    port,
  };
}

