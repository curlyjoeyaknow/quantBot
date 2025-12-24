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

/**
 * Handler function: pure use-case orchestration
 */
export async function ohlcvStatsWorkflowHandler(
  args: OhlcvStatsWorkflowArgs,
  _ctx: CommandContext
): Promise<GetOhlcvStatsResult | Array<Record<string, unknown>>> {
  // Build workflow spec
  const spec: GetOhlcvStatsSpec = {
    chain: args.chain,
    interval: args.interval,
    mint: args.mint,
  };

  // Create workflow context (now uses ports, no direct client needed)
  const workflowContext = await createOhlcvStatsContext();

  // Call workflow
  const result = await getOhlcvStats(spec, workflowContext);

  // If format is JSON, return raw object structure
  if (args.format === 'json') {
    return result;
  }

  // For table/CSV format, transform to array of rows with readable labels
  const rows: Array<Record<string, unknown>> = [];

  // Add summary section
  rows.push({
    section: '📊 SUMMARY',
    label: 'Total',
    candleCount: result.totalCandles.toLocaleString(),
    tokenCount: result.uniqueTokens.toLocaleString(),
    dateEarliest: result.dateRange.earliest
      ? new Date(result.dateRange.earliest).toLocaleString()
      : 'N/A',
    dateLatest: result.dateRange.latest
      ? new Date(result.dateRange.latest).toLocaleString()
      : 'N/A',
  });

  // Add separator
  rows.push({
    section: '',
    label: '',
    candleCount: '',
    tokenCount: '',
    dateEarliest: '',
    dateLatest: '',
  });

  // Add interval breakdown with labels
  if (result.intervals && result.intervals.length > 0) {
    rows.push({
      section: '⏱️  BY INTERVAL',
      label: '',
      candleCount: '',
      tokenCount: '',
      dateEarliest: '',
      dateLatest: '',
    });
    for (const interval of result.intervals) {
      rows.push({
        section: '',
        label: `  ${interval.interval}`,
        candleCount: interval.candleCount.toLocaleString(),
        tokenCount: interval.tokenCount.toLocaleString(),
        dateEarliest: '',
        dateLatest: '',
      });
    }
    rows.push({
      section: '',
      label: '',
      candleCount: '',
      tokenCount: '',
      dateEarliest: '',
      dateLatest: '',
    });
  }

  // Add chain breakdown with labels
  if (result.chains && result.chains.length > 0) {
    rows.push({
      section: '⛓️  BY CHAIN',
      label: '',
      candleCount: '',
      tokenCount: '',
      dateEarliest: '',
      dateLatest: '',
    });
    for (const chain of result.chains) {
      rows.push({
        section: '',
        label: `  ${chain.chain}`,
        candleCount: chain.candleCount.toLocaleString(),
        tokenCount: chain.tokenCount.toLocaleString(),
        dateEarliest: '',
        dateLatest: '',
      });
    }
    rows.push({
      section: '',
      label: '',
      candleCount: '',
      tokenCount: '',
      dateEarliest: '',
      dateLatest: '',
    });
  }

  // Add top tokens with labels
  if (result.topTokens && result.topTokens.length > 0) {
    rows.push({
      section: '🏆 TOP TOKENS',
      label: '',
      candleCount: '',
      tokenCount: '',
      dateEarliest: '',
      dateLatest: '',
    });
    for (const token of result.topTokens) {
      const shortAddress = token.token_address;
      rows.push({
        section: '',
        label: `  ${shortAddress} (${token.chain})`,
        candleCount: token.candleCount.toLocaleString(),
        tokenCount: '',
        dateEarliest: token.firstSeen ? new Date(token.firstSeen).toLocaleDateString() : '',
        dateLatest: token.lastSeen ? new Date(token.lastSeen).toLocaleDateString() : '',
      });
    }
  }

  return rows;
}
