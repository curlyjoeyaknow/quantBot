/**
 * Alert Coverage Map Handler
 *
 * For each alert in DuckDB, checks if sufficient OHLCV coverage exists
 * in ClickHouse for the specified horizon from the alert time.
 */

import { z } from 'zod';
import { DateTime } from 'luxon';
import type { CommandContext } from '../../core/command-context.js';
import { getDuckDBWorklistService } from '@quantbot/storage';

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

export const alertCoverageMapSchema = z.object({
  duckdb: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  horizonSeconds: z.coerce.number().int().min(60).default(7200), // 2 hours default
  interval: z.enum(['1s', '15s', '1m', '5m']).optional(), // If not specified, check all
  minCoverage: z.coerce.number().min(0).max(1).default(0.95), // 95% coverage threshold
  format: z.enum(['json', 'table']).default('table'),
});

export type AlertCoverageMapArgs = z.infer<typeof alertCoverageMapSchema>;

interface IntervalCoverage {
  interval: string;
  intervalSeconds: number;
  expectedCandles: number;
  alertsWithFullCoverage: number;
  alertsWithPartialCoverage: number;
  alertsWithNoCoverage: number;
  totalAlerts: number;
  coveragePercent: number;
}

interface AlertCoverageMapResult {
  summary: {
    totalAlerts: number;
    uniqueTokens: number;
    horizonSeconds: number;
    minCoverageThreshold: number;
    dateRange: { from: string; to: string };
  };
  byInterval: IntervalCoverage[];
  worstTokens: Array<{
    token: string;
    alertTime: string;
    interval: string;
    actualCandles: number;
    expectedCandles: number;
    coveragePercent: number;
  }>;
}

export async function alertCoverageMapHandler(
  args: AlertCoverageMapArgs,
  ctx: CommandContext
): Promise<AlertCoverageMapResult> {
  const client = ctx.services.clickHouseClient();
  const database = process.env.CLICKHOUSE_DATABASE || 'quantbot';
  const { horizonSeconds, minCoverage } = args;

  // Get alerts from DuckDB
  print('');
  print(
    `${c.bold}${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`
  );
  print(`${c.bold}${c.cyan}  📊 Alert Coverage Map${c.reset}`);
  print(
    `${c.gray}  Horizon: ${horizonSeconds}s | Min Coverage: ${(minCoverage * 100).toFixed(0)}%${c.reset}`
  );
  print(
    `${c.bold}${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`
  );
  print('');

  print(`${c.blue}📋 Fetching alerts from DuckDB...${c.reset}`);

  const worklistService = getDuckDBWorklistService();
  const worklist = await worklistService.queryWorklist({
    duckdbPath: args.duckdb,
    from: args.from,
    to: args.to,
    side: 'buy',
  });

  if (worklist.calls.length === 0) {
    print(`${c.yellow}⚠ No alerts found in date range${c.reset}`);
    return {
      summary: {
        totalAlerts: 0,
        uniqueTokens: 0,
        horizonSeconds,
        minCoverageThreshold: minCoverage,
        dateRange: { from: args.from || 'all', to: args.to || 'now' },
      },
      byInterval: [],
      worstTokens: [],
    };
  }

  print(`${c.green}✓ Found ${worklist.calls.length} alerts${c.reset}`);
  print('');

  // Intervals to check
  const intervalsToCheck = args.interval ? [args.interval] : ['1s', '15s', '1m', '5m'];

  const intervalSecondsMap: Record<string, number> = {
    '1s': 1,
    '15s': 15,
    '1m': 60,
    '5m': 300,
  };

  const byInterval: IntervalCoverage[] = [];
  const worstTokens: Array<{
    token: string;
    alertTime: string;
    interval: string;
    actualCandles: number;
    expectedCandles: number;
    coveragePercent: number;
  }> = [];

  for (const interval of intervalsToCheck) {
    const intervalSec = intervalSecondsMap[interval];
    const expectedCandles = Math.ceil(horizonSeconds / intervalSec);

    print(
      `${c.blue}Checking ${interval} coverage (expecting ${expectedCandles} candles per alert)...${c.reset}`
    );

    let fullCoverage = 0;
    let partialCoverage = 0;
    let noCoverage = 0;

    // Check coverage for each alert in batches
    const batchSize = 100;
    for (let i = 0; i < worklist.calls.length; i += batchSize) {
      const batch = worklist.calls.slice(i, i + batchSize);

      // Build a query to check all alerts in the batch at once
      const conditions = batch
        .map((alert: { mint: string; alertTime: string | null }) => {
          if (!alert.alertTime) return null;
          const alertDateTime = DateTime.fromISO(alert.alertTime).toUTC();
          const endTime = alertDateTime.plus({ seconds: horizonSeconds });
          // Format as YYYY-MM-DD HH:mm:ss for ClickHouse compatibility
          const startStr = alertDateTime.toFormat('yyyy-MM-dd HH:mm:ss');
          const endStr = endTime.toFormat('yyyy-MM-dd HH:mm:ss');
          return `(token_address = '${alert.mint}' AND timestamp >= '${startStr}' AND timestamp < '${endStr}')`;
        })
        .filter((c): c is string => c !== null);

      const query = `
        SELECT 
          token_address,
          min(timestamp) as first_candle,
          count() as candle_count
        FROM ${database}.ohlcv_candles
        WHERE interval_seconds = ${intervalSec}
          AND (${conditions.join(' OR ')})
        GROUP BY token_address
      `;

      const result = await client.query({ query, format: 'JSONEachRow' });
      const rows = (await result.json()) as Array<{
        token_address: string;
        first_candle: string;
        candle_count: string;
      }>;

      // Create a map of token -> candle count
      const coverageMap = new Map<string, number>();
      for (const row of rows) {
        coverageMap.set(row.token_address, Number(row.candle_count));
      }

      // Check each alert in the batch
      for (const alert of batch) {
        const typedAlert = alert as { mint: string; alertTime: string | null };
        if (!typedAlert.alertTime) continue;

        const actualCandles = coverageMap.get(typedAlert.mint) || 0;
        const coverageRatio = actualCandles / expectedCandles;

        if (coverageRatio >= minCoverage) {
          fullCoverage++;
        } else if (actualCandles > 0) {
          partialCoverage++;
          // Track worst tokens (partial coverage)
          if (worstTokens.length < 20) {
            worstTokens.push({
              token: typedAlert.mint,
              alertTime: typedAlert.alertTime,
              interval,
              actualCandles,
              expectedCandles,
              coveragePercent: coverageRatio * 100,
            });
          }
        } else {
          noCoverage++;
          // Track worst tokens (no coverage)
          if (worstTokens.length < 20) {
            worstTokens.push({
              token: typedAlert.mint,
              alertTime: typedAlert.alertTime,
              interval,
              actualCandles: 0,
              expectedCandles,
              coveragePercent: 0,
            });
          }
        }
      }
    }

    const total = worklist.calls.length;
    const coveragePercent = (fullCoverage / total) * 100;

    byInterval.push({
      interval,
      intervalSeconds: intervalSec,
      expectedCandles,
      alertsWithFullCoverage: fullCoverage,
      alertsWithPartialCoverage: partialCoverage,
      alertsWithNoCoverage: noCoverage,
      totalAlerts: total,
      coveragePercent,
    });

    // Print interval result
    const statusColor = coveragePercent >= 90 ? c.green : coveragePercent >= 50 ? c.yellow : c.red;
    const statusIcon = coveragePercent >= 90 ? '✓' : coveragePercent >= 50 ? '⚠' : '✗';
    print(
      `  ${statusColor}${statusIcon} ${interval}: ${fullCoverage}/${total} alerts (${coveragePercent.toFixed(1)}%) have full coverage${c.reset}`
    );
    if (partialCoverage > 0) {
      print(`    ${c.yellow}${partialCoverage} partial${c.reset}`);
    }
    if (noCoverage > 0) {
      print(`    ${c.red}${noCoverage} missing${c.reset}`);
    }
  }

  print('');

  // Sort worst tokens by coverage
  worstTokens.sort((a, b) => a.coveragePercent - b.coveragePercent);

  // Print summary table
  print(`${c.bold}Summary:${c.reset}`);
  print(
    `${c.gray}  ${'Interval'.padEnd(10)} ${'Full'.padStart(8)} ${'Partial'.padStart(8)} ${'None'.padStart(8)} ${'Coverage'.padStart(10)}${c.reset}`
  );
  print(
    `${c.gray}  ${'─'.repeat(10)} ${'─'.repeat(8)} ${'─'.repeat(8)} ${'─'.repeat(8)} ${'─'.repeat(10)}${c.reset}`
  );

  for (const iv of byInterval) {
    const statusColor =
      iv.coveragePercent >= 90 ? c.green : iv.coveragePercent >= 50 ? c.yellow : c.red;
    print(
      `  ${iv.interval.padEnd(10)} ${iv.alertsWithFullCoverage.toString().padStart(8)} ${iv.alertsWithPartialCoverage.toString().padStart(8)} ${iv.alertsWithNoCoverage.toString().padStart(8)} ${statusColor}${iv.coveragePercent.toFixed(1).padStart(9)}%${c.reset}`
    );
  }

  print('');
  print(
    `${c.bold}${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`
  );
  print('');

  const uniqueTokens = new Set(worklist.calls.map((a: { mint: string }) => a.mint)).size;

  return {
    summary: {
      totalAlerts: worklist.calls.length,
      uniqueTokens,
      horizonSeconds,
      minCoverageThreshold: minCoverage,
      dateRange: { from: args.from || 'all', to: args.to || 'now' },
    },
    byInterval,
    worstTokens: worstTokens.slice(0, 10),
  };
}
