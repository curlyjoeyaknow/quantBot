/**
 * OHLCV Coverage Map Handler
 *
 * Shows precise coverage statistics for all intervals with colored output.
 */

import { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';

// Console colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function print(msg: string) {
  process.stdout.write(msg + '\n');
}

export const coverageMapSchema = z.object({
  from: z.string().optional(), // Filter by date range
  to: z.string().optional(),
  format: z.enum(['json', 'table']).default('table'),
});

export type CoverageMapArgs = z.infer<typeof coverageMapSchema>;

interface IntervalStats {
  interval: string;
  intervalSeconds: number;
  candles: number;
  tokens: number;
  earliest: string;
  latest: string;
}

interface CoverageMapResult {
  overall: {
    totalCandles: number;
    totalTokens: number;
    earliest: string;
    latest: string;
  };
  byInterval: IntervalStats[];
  dataQualityIssues: string[];
}

export async function coverageMapHandler(
  args: CoverageMapArgs,
  ctx: CommandContext
): Promise<CoverageMapResult> {
  const client = ctx.services.clickHouseClient();
  const database = process.env.CLICKHOUSE_DATABASE || 'quantbot';

  // Build date filter
  let dateFilter = '';
  if (args.from || args.to) {
    const conditions: string[] = [];
    if (args.from) conditions.push(`timestamp >= '${args.from}'`);
    if (args.to) conditions.push(`timestamp < '${args.to}'`);
    dateFilter = `WHERE ${conditions.join(' AND ')}`;
  }

  // Query overall stats
  const overallQuery = `
    SELECT 
      count() as total_candles,
      uniq(token_address) as total_tokens,
      min(timestamp) as earliest,
      max(timestamp) as latest
    FROM ${database}.ohlcv_candles
    ${dateFilter}
  `;

  const overallResult = await client.query({ query: overallQuery, format: 'JSONEachRow' });
  const overallData = (await overallResult.json()) as Array<{
    total_candles: string;
    total_tokens: string;
    earliest: string;
    latest: string;
  }>;
  const overall = overallData[0];

  // Query by interval
  const intervalQuery = `
    SELECT 
      interval_seconds,
      count() as candles,
      uniq(token_address) as tokens,
      min(timestamp) as earliest,
      max(timestamp) as latest
    FROM ${database}.ohlcv_candles
    ${dateFilter}
    GROUP BY interval_seconds
    ORDER BY interval_seconds
  `;

  const intervalResult = await client.query({ query: intervalQuery, format: 'JSONEachRow' });
  const intervalData = (await intervalResult.json()) as Array<{
    interval_seconds: number;
    candles: string;
    tokens: string;
    earliest: string;
    latest: string;
  }>;

  // Map interval seconds to labels
  const intervalLabels: Record<number, string> = {
    1: '1s',
    15: '15s',
    60: '1m',
    300: '5m',
    900: '15m',
    3600: '1h',
    14400: '4h',
    86400: '1d',
  };

  const byInterval: IntervalStats[] = intervalData.map((row) => ({
    interval: intervalLabels[row.interval_seconds] || `${row.interval_seconds}s`,
    intervalSeconds: row.interval_seconds,
    candles: Number(row.candles),
    tokens: Number(row.tokens),
    earliest: row.earliest,
    latest: row.latest,
  }));

  // Check for data quality issues
  const issues: string[] = [];
  const zeroInterval = byInterval.find((i) => i.intervalSeconds === 0);
  if (zeroInterval) {
    issues.push(`${zeroInterval.candles.toLocaleString()} candles with interval_seconds=0 (invalid)`);
  }

  const result: CoverageMapResult = {
    overall: {
      totalCandles: Number(overall.total_candles),
      totalTokens: Number(overall.total_tokens),
      earliest: overall.earliest,
      latest: overall.latest,
    },
    byInterval,
    dataQualityIssues: issues,
  };

  // Print formatted output for table format
  if (args.format === 'table') {
    const dateRange = args.from || args.to 
      ? `${args.from || 'start'} → ${args.to || 'now'}`
      : 'All Time';

    print('');
    print(`${c.bold}${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
    print(`${c.bold}${c.cyan}  📊 OHLCV Coverage Map${c.reset} ${c.gray}(${dateRange})${c.reset}`);
    print(`${c.bold}${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
    print('');

    // Overall stats
    print(`${c.bold}Overall:${c.reset}`);
    print(`  Candles: ${c.bold}${result.overall.totalCandles.toLocaleString()}${c.reset}`);
    print(`  Tokens:  ${c.bold}${result.overall.totalTokens.toLocaleString()}${c.reset}`);
    print(`  Range:   ${result.overall.earliest} → ${result.overall.latest}`);
    print('');

    // By interval table
    print(`${c.bold}By Interval:${c.reset}`);
    print(`${c.gray}  ${'Interval'.padEnd(10)} ${'Candles'.padStart(15)} ${'Tokens'.padStart(10)} ${'Earliest'.padStart(12)} ${'Latest'.padStart(12)}${c.reset}`);
    print(`${c.gray}  ${'─'.repeat(10)} ${'─'.repeat(15)} ${'─'.repeat(10)} ${'─'.repeat(12)} ${'─'.repeat(12)}${c.reset}`);

    for (const interval of byInterval) {
      const color = interval.intervalSeconds === 0 ? c.red : c.reset;
      const label = interval.intervalSeconds === 0 ? `${interval.interval} ⚠` : interval.interval;
      const earliest = interval.earliest.substring(0, 10);
      const latest = interval.latest.substring(0, 10);
      print(`  ${color}${label.padEnd(10)} ${interval.candles.toLocaleString().padStart(15)} ${interval.tokens.toString().padStart(10)} ${earliest.padStart(12)} ${latest.padStart(12)}${c.reset}`);
    }
    print('');

    // Data quality issues
    if (issues.length > 0) {
      print(`${c.bold}${c.yellow}⚠ Data Quality Issues:${c.reset}`);
      for (const issue of issues) {
        print(`  ${c.yellow}• ${issue}${c.reset}`);
      }
      print('');
    }

    print(`${c.bold}${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
    print('');
  }

  return result;
}

