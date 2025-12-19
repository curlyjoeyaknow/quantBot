/**
 * Handler for token stats workflow command
 *
 * Pure use-case function: takes validated args and context, calls workflow.
 */

import type { CommandContext } from '../../core/command-context.js';
import {
  getTokenStats,
  createTokenStatsContext,
  type GetTokenStatsSpec,
  type GetTokenStatsResult,
} from '@quantbot/workflows';

/**
 * Input arguments (already validated by Zod)
 */
export type TokenStatsWorkflowArgs = {
  from?: string;
  to?: string;
  chain?: 'solana' | 'ethereum' | 'bsc' | 'base';
  duckdbPath?: string;
  limit?: number;
  format?: 'json' | 'table' | 'csv';
};

interface TokenStatsRow {
  mint: string;
  chain: string;
  ticker?: string;
  firstCallTime: string;
  lastCallTime: string;
  callCount: number;
  ohlcvEnriched: string; // 'yes' | 'no'
  totalCandles: number;
  timeframes: string; // comma-separated
  simulationsRun: number;
  dateEarliest?: string;
  dateLatest?: string;
}

/**
 * Handler function: pure use-case orchestration
 */
export async function tokenStatsWorkflowHandler(
  args: TokenStatsWorkflowArgs,
  ctx: CommandContext
): Promise<GetTokenStatsResult | TokenStatsRow[]> {
  // Build workflow spec
  const spec: GetTokenStatsSpec = {
    from: args.from,
    to: args.to,
    chain: args.chain,
    duckdbPath: args.duckdbPath,
    limit: args.limit,
  };

  // Create workflow context with ClickHouse client from CommandContext
  const workflowContext = createTokenStatsContext({
    clickHouseClient: ctx.services.clickHouseClient(),
    duckdbPath: args.duckdbPath,
  });

  // Call workflow
  const result = await getTokenStats(spec, workflowContext);

  // If format is JSON, return raw object structure
  if (args.format === 'json') {
    return result;
  }

  // For table/CSV format, transform to array of rows
  const rows: TokenStatsRow[] = result.tokens.map((token) => ({
    mint: token.mint,
    chain: token.chain,
    ticker: token.ticker,
    firstCallTime: token.firstCallTime,
    lastCallTime: token.lastCallTime,
    callCount: token.callCount,
    ohlcvEnriched: token.ohlcvEnriched ? 'yes' : 'no',
    totalCandles: token.totalCandles,
    timeframes: token.timeframes.join(', '),
    simulationsRun: token.simulationsRun,
    dateEarliest: token.dateRange?.earliest,
    dateLatest: token.dateRange?.latest,
  }));

  return rows;
}

