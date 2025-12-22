/**
 * Handler for OHLCV stats workflow command
 *
 * Pure use-case function: takes validated args and context, calls workflow.
 */

import type { CommandContext } from '../../core/command-context.js';
import {
  getOhlcvStats,
  createOhlcvStatsContext,
  type GetOhlcvStatsSpec,
  type GetOhlcvStatsResult,
} from '@quantbot/workflows';

/**
 * Input arguments (already validated by Zod)
 */
export type OhlcvStatsWorkflowArgs = {
  chain?: 'solana' | 'ethereum' | 'bsc' | 'base';
  interval?: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
  mint?: string;
  format?: 'json' | 'table' | 'csv';
};

interface OhlcvStatsRow {
  type: 'summary' | 'interval' | 'chain' | 'token';
  interval?: string;
  chain?: string;
  token_address?: string;
  candleCount?: number;
  tokenCount?: number;
  firstSeen?: string;
  lastSeen?: string;
  dateEarliest?: string;
  dateLatest?: string;
}

/**
 * Handler function: pure use-case orchestration
 */
export async function ohlcvStatsWorkflowHandler(
  args: OhlcvStatsWorkflowArgs,
  ctx: CommandContext
): Promise<GetOhlcvStatsResult | OhlcvStatsRow[]> {
  // Build workflow spec
  const spec: GetOhlcvStatsSpec = {
    chain: args.chain,
    interval: args.interval,
    mint: args.mint,
  };

  // Create workflow context with ClickHouse client from CommandContext
  const workflowContext = createOhlcvStatsContext({
    clickHouseClient: ctx.services.clickHouseClient(),
  });

  // Call workflow
  const result = await getOhlcvStats(spec, workflowContext);

  // If format is JSON, return raw object structure
  if (args.format === 'json') {
    return result;
  }

  // For table/CSV format, transform to array of rows
  const rows: OhlcvStatsRow[] = [];

  // Add summary row
  rows.push({
    type: 'summary',
    candleCount: result.totalCandles,
    tokenCount: result.uniqueTokens,
    dateEarliest: result.dateRange.earliest,
    dateLatest: result.dateRange.latest,
  });

  // Add interval rows
  if (result.intervals && result.intervals.length > 0) {
    for (const interval of result.intervals) {
      rows.push({
        type: 'interval',
        interval: interval.interval,
        candleCount: interval.candleCount,
        tokenCount: interval.tokenCount,
      });
    }
  }

  // Add chain rows
  if (result.chains && result.chains.length > 0) {
    for (const chain of result.chains) {
      rows.push({
        type: 'chain',
        chain: chain.chain,
        candleCount: chain.candleCount,
        tokenCount: chain.tokenCount,
      });
    }
  }

  // Add top token rows
  if (result.topTokens && result.topTokens.length > 0) {
    for (const token of result.topTokens) {
      rows.push({
        type: 'token',
        token_address: token.token_address,
        chain: token.chain,
        candleCount: token.candleCount,
        firstSeen: token.firstSeen,
        lastSeen: token.lastSeen,
      });
    }
  }

  return rows;
}
