/**
 * Alert Coverage Map Handler
 *
 * For each alert in DuckDB, checks if sufficient OHLCV coverage exists
 * in ClickHouse. Coverage is measured PER ALERT, PER INTERVAL.
 *
 * Coverage tiers (in seconds of candle data):
 * - 1m: Tier1=150k, Tier2=300k, Tier3=450k seconds
 * - 5m: Tier1=750k, Tier2=1.5M, Tier3=2.25M seconds
 */

import { z } from 'zod';
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
  format: z.enum(['json', 'table']).default('table'),
});

export type AlertCoverageMapArgs = z.infer<typeof alertCoverageMapSchema>;

// Coverage tiers in SECONDS of candle data (3 tiers per interval)
const COVERAGE_TIERS: Record<string, number[]> = {
  '1m': [150_000, 300_000, 450_000], // 2,500 / 5,000 / 7,500 candles × 60s
  '5m': [750_000, 1_500_000, 2_250_000], // 2,500 / 5,000 / 7,500 candles × 300s
};

const INTERVAL_SECONDS: Record<string, number> = {
  '1m': 60,
  '5m': 300,
};

interface AlertCoverage {
  mint: string;
  alertTsMs: number;
  interval: string;
  candleCount: number;
  coverageSeconds: number;
  tier1: boolean;
  tier2: boolean;
  tier3: boolean;
}

interface TierSummary {
  thresholdSeconds: number;
  thresholdCandles: number;
  count: number;
  percent: number;
}

interface IntervalSummary {
  interval: string;
  tier1: TierSummary;
  tier2: TierSummary;
  tier3: TierSummary;
  noCoverage: number;
  totalAlerts: number;
}

interface AlertCoverageMapResult {
  summary: {
    totalAlerts: number;
    uniqueTokens: number;
    dateRange: { from: string; to: string };
  };
  byInterval: IntervalSummary[];
  bestAlerts: AlertCoverage[];
  worstAlerts: AlertCoverage[];
}

function formatSeconds(sec: number): string {
  if (sec >= 1_000_000) {
    return `${(sec / 1_000_000).toFixed(2)}M`;
  }
  return `${(sec / 1000).toFixed(0)}k`;
}

export async function alertCoverageMapHandler(
  args: AlertCoverageMapArgs,
  ctx: CommandContext
): Promise<AlertCoverageMapResult> {
  const client = ctx.services.clickHouseClient();
  const database = process.env.CLICKHOUSE_DATABASE || 'quantbot';

  // Get alerts from DuckDB
  print('');
  print(
    `${c.bold}${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`
  );
  print(`${c.bold}${c.cyan}  📊 Alert Coverage Map (Per-Alert, Per-Interval)${c.reset}`);
  print(
    `${c.gray}  1m Tiers: ${COVERAGE_TIERS['1m'].map((t) => formatSeconds(t)).join(' / ')} sec${c.reset}`
  );
  print(
    `${c.gray}  5m Tiers: ${COVERAGE_TIERS['5m'].map((t) => formatSeconds(t)).join(' / ')} sec${c.reset}`
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
        dateRange: { from: args.from || 'all', to: args.to || 'now' },
      },
      byInterval: [],
      bestAlerts: [],
      worstAlerts: [],
    };
  }

  print(`${c.green}✓ Found ${worklist.calls.length} alerts${c.reset}`);
  print('');

  // Filter alerts with valid timestamps
  const validAlerts = worklist.calls.filter(
    (
      a
    ): a is {
      mint: string;
      chain: string;
      alertTsMs: number;
      chatId: string | null;
      messageId: string | null;
      priceUsd: number | null;
      mcapUsd: number | null;
      botTsMs: number | null;
    } => a.alertTsMs !== null && a.alertTsMs !== undefined
  );

  print(`${c.gray}  (${validAlerts.length} alerts with valid timestamps)${c.reset}`);
  print('');

  const intervals = ['1m', '5m'];
  const byInterval: IntervalSummary[] = [];
  const allAlertCoverage: AlertCoverage[] = [];

  for (const interval of intervals) {
    const intervalSec = INTERVAL_SECONDS[interval];
    const tiers = COVERAGE_TIERS[interval];
    const [tier1Threshold, tier2Threshold, tier3Threshold] = tiers;

    print(`${c.blue}Checking ${interval} coverage...${c.reset}`);
    print(
      `${c.gray}  Tiers: ${formatSeconds(tier1Threshold)} / ${formatSeconds(tier2Threshold)} / ${formatSeconds(tier3Threshold)} sec${c.reset}`
    );

    let tier1Count = 0;
    let tier2Count = 0;
    let tier3Count = 0;
    let noCoverage = 0;

    // Check EACH alert individually
    const batchSize = 50;
    for (let i = 0; i < validAlerts.length; i += batchSize) {
      const batch = validAlerts.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(async (alert) => {
          const alertTsSeconds = Math.floor(alert.alertTsMs / 1000);
          const startDate = new Date(alertTsSeconds * 1000);
          const startStr = startDate.toISOString().replace('T', ' ').slice(0, 19);

          const query = `
            SELECT count() as candle_count
            FROM ${database}.ohlcv_candles
            WHERE interval_seconds = ${intervalSec}
              AND token_address = '${alert.mint}'
              AND timestamp >= '${startStr}'
          `;

          try {
            const result = await client.query({ query, format: 'JSONEachRow' });
            const rows = (await result.json()) as Array<{ candle_count: string }>;
            const candleCount = rows.length > 0 ? Number(rows[0].candle_count) : 0;
            const coverageSeconds = candleCount * intervalSec;

            return {
              mint: alert.mint,
              alertTsMs: alert.alertTsMs,
              interval,
              candleCount,
              coverageSeconds,
              tier1: coverageSeconds >= tier1Threshold,
              tier2: coverageSeconds >= tier2Threshold,
              tier3: coverageSeconds >= tier3Threshold,
            };
          } catch {
            return {
              mint: alert.mint,
              alertTsMs: alert.alertTsMs,
              interval,
              candleCount: 0,
              coverageSeconds: 0,
              tier1: false,
              tier2: false,
              tier3: false,
            };
          }
        })
      );

      for (const result of batchResults) {
        allAlertCoverage.push(result);

        if (result.tier3) {
          tier3Count++;
        } else if (result.tier2) {
          tier2Count++;
        } else if (result.tier1) {
          tier1Count++;
        } else if (result.candleCount === 0) {
          noCoverage++;
        }
        // else: has some coverage but doesn't meet tier1
      }

      if ((i + batchSize) % 200 === 0 || i + batchSize >= validAlerts.length) {
        const progress = Math.min(i + batchSize, validAlerts.length);
        print(`${c.gray}    Processed ${progress}/${validAlerts.length} alerts...${c.reset}`);
      }
    }

    const total = validAlerts.length;

    // Count alerts meeting each tier threshold (cumulative)
    const meetsTier1 = allAlertCoverage.filter((a) => a.interval === interval && a.tier1).length;
    const meetsTier2 = allAlertCoverage.filter((a) => a.interval === interval && a.tier2).length;
    const meetsTier3 = allAlertCoverage.filter((a) => a.interval === interval && a.tier3).length;

    byInterval.push({
      interval,
      tier1: {
        thresholdSeconds: tier1Threshold,
        thresholdCandles: Math.floor(tier1Threshold / intervalSec),
        count: meetsTier1,
        percent: (meetsTier1 / total) * 100,
      },
      tier2: {
        thresholdSeconds: tier2Threshold,
        thresholdCandles: Math.floor(tier2Threshold / intervalSec),
        count: meetsTier2,
        percent: (meetsTier2 / total) * 100,
      },
      tier3: {
        thresholdSeconds: tier3Threshold,
        thresholdCandles: Math.floor(tier3Threshold / intervalSec),
        count: meetsTier3,
        percent: (meetsTier3 / total) * 100,
      },
      noCoverage,
      totalAlerts: total,
    });

    // Print interval result
    print('');
    print(`  ${c.bold}${interval} Coverage:${c.reset}`);
    print(
      `    ${c.green}Tier1 (≥${formatSeconds(tier1Threshold)}): ${meetsTier1}/${total} (${((meetsTier1 / total) * 100).toFixed(1)}%)${c.reset}`
    );
    print(
      `    ${c.cyan}Tier2 (≥${formatSeconds(tier2Threshold)}): ${meetsTier2}/${total} (${((meetsTier2 / total) * 100).toFixed(1)}%)${c.reset}`
    );
    print(
      `    ${c.blue}Tier3 (≥${formatSeconds(tier3Threshold)}): ${meetsTier3}/${total} (${((meetsTier3 / total) * 100).toFixed(1)}%)${c.reset}`
    );
    print(`    ${c.red}None: ${noCoverage}${c.reset}`);
    print('');
  }

  // Find best and worst alerts
  const sortedByBest = [...allAlertCoverage].sort((a, b) => b.coverageSeconds - a.coverageSeconds);
  const sortedByWorst = [...allAlertCoverage].sort((a, b) => a.coverageSeconds - b.coverageSeconds);

  const bestAlerts = sortedByBest.slice(0, 30);
  const worstAlerts = sortedByWorst.slice(0, 30);

  // Print summary table
  print(`${c.bold}Summary by Tier:${c.reset}`);
  print(
    `${c.gray}  ${'Interval'.padEnd(8)} ${'Tier'.padEnd(6)} ${'Threshold'.padStart(12)} ${'Count'.padStart(8)} ${'Percent'.padStart(10)}${c.reset}`
  );
  print(
    `${c.gray}  ${'─'.repeat(8)} ${'─'.repeat(6)} ${'─'.repeat(12)} ${'─'.repeat(8)} ${'─'.repeat(10)}${c.reset}`
  );

  for (const iv of byInterval) {
    const tiers = [
      { name: 'Tier1', data: iv.tier1, color: c.green },
      { name: 'Tier2', data: iv.tier2, color: c.cyan },
      { name: 'Tier3', data: iv.tier3, color: c.blue },
    ];

    for (const tier of tiers) {
      const thresholdStr = formatSeconds(tier.data.thresholdSeconds);
      print(
        `  ${iv.interval.padEnd(8)} ${tier.name.padEnd(6)} ${(thresholdStr + ' sec').padStart(12)} ${tier.data.count.toString().padStart(8)} ${tier.color}${tier.data.percent.toFixed(1).padStart(9)}%${c.reset}`
      );
    }
    print(
      `  ${iv.interval.padEnd(8)} ${'None'.padEnd(6)} ${'-'.padStart(12)} ${iv.noCoverage.toString().padStart(8)} ${c.red}${((iv.noCoverage / iv.totalAlerts) * 100).toFixed(1).padStart(9)}%${c.reset}`
    );
    print('');
  }

  // Print best 30 alerts
  print(`${c.bold}${c.green}Top 30 Alerts (highest coverage):${c.reset}`);
  print(
    `${c.gray}  ${'Token'.padEnd(14)} ${'Interval'.padEnd(8)} ${'Candles'.padStart(10)} ${'Coverage'.padStart(14)}${c.reset}`
  );
  print(
    `${c.gray}  ${'─'.repeat(14)} ${'─'.repeat(8)} ${'─'.repeat(10)} ${'─'.repeat(14)}${c.reset}`
  );

  for (const alert of bestAlerts) {
    const shortMint = `${alert.mint.slice(0, 10)}...`;
    const coverageStr = formatSeconds(alert.coverageSeconds) + ' sec';
    print(
      `  ${shortMint.padEnd(14)} ${alert.interval.padEnd(8)} ${alert.candleCount.toLocaleString().padStart(10)} ${c.green}${coverageStr.padStart(14)}${c.reset}`
    );
  }
  print('');

  // Print worst 30 alerts
  print(`${c.bold}${c.red}Worst 30 Alerts (lowest coverage):${c.reset}`);
  print(
    `${c.gray}  ${'Token'.padEnd(14)} ${'Interval'.padEnd(8)} ${'Candles'.padStart(10)} ${'Coverage'.padStart(14)}${c.reset}`
  );
  print(
    `${c.gray}  ${'─'.repeat(14)} ${'─'.repeat(8)} ${'─'.repeat(10)} ${'─'.repeat(14)}${c.reset}`
  );

  for (const alert of worstAlerts) {
    const shortMint = `${alert.mint.slice(0, 10)}...`;
    const coverageStr = formatSeconds(alert.coverageSeconds) + ' sec';
    print(
      `  ${shortMint.padEnd(14)} ${alert.interval.padEnd(8)} ${alert.candleCount.toLocaleString().padStart(10)} ${c.red}${coverageStr.padStart(14)}${c.reset}`
    );
  }
  print('');

  print(
    `${c.bold}${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`
  );
  print('');

  const uniqueTokens = new Set(validAlerts.map((a) => a.mint)).size;

  return {
    summary: {
      totalAlerts: validAlerts.length,
      uniqueTokens,
      dateRange: { from: args.from || 'all', to: args.to || 'now' },
    },
    byInterval,
    bestAlerts,
    worstAlerts,
  };
}
