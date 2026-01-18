import { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { getDuckDBWorklistService } from '@quantbot/infra/storage';
import { dt } from '@quantbot/infra/utils';

export const coverageDashboardSchema = z.object({
  refreshInterval: z.coerce.number().int().min(1).default(5),
  duckdb: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export type CoverageDashboardArgs = z.infer<typeof coverageDashboardSchema>;

// Minimum coverage seconds per interval (Tier 1 thresholds from alert-coverage-map)
const MIN_COVERAGE_SECONDS: Record<string, number> = {
  '1m': 150_000, // ~2500 candles
  '5m': 750_000, // ~2500 candles
};

interface IntervalCoverage {
  interval: string;
  intervalSeconds: number;
  minCoverageSeconds: number;
  minCoverageCandles: number;
  totalAlerts: number;
  coveredAlerts: number;
  percent: number;
  monthlyBreakdown: MonthCoverage[];
}

interface MonthCoverage {
  month: string;
  totalAlerts: number;
  coveredAlerts: number;
  percent: number;
}

interface DashboardResult {
  totalCandles: number;
  totalAlerts: number;
  uniqueTokens: number;
  intervals: IntervalCoverage[];
  dateRange: { from: string; to: string };
  timestamp: string;
}

function makeBar(percent: number, width = 40): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function colorPercent(pct: number): string {
  if (pct >= 90) return `\x1b[32m${pct.toFixed(0)}%\x1b[0m`; // green
  if (pct >= 70) return `\x1b[33m${pct.toFixed(0)}%\x1b[0m`; // yellow
  return `\x1b[31m${pct.toFixed(0)}%\x1b[0m`; // red
}

function colorBar(percent: number): string {
  const bar = makeBar(percent);
  if (percent >= 90) return `\x1b[32m${bar}\x1b[0m`;
  if (percent >= 70) return `\x1b[33m${bar}\x1b[0m`;
  return `\x1b[31m${bar}\x1b[0m`;
}

function formatSeconds(sec: number): string {
  if (sec >= 1_000_000) {
    return `${(sec / 1_000_000).toFixed(1)}M`;
  }
  return `${(sec / 1000).toFixed(0)}k`;
}

interface Alert {
  mint: string;
  alertTsMs: number;
  month: string; // YYYY-MM
}

// Convert Unix seconds to ClickHouse DateTime string (YYYY-MM-DD HH:mm:ss)
function toClickhouseDateTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

interface AlertCoverageResult {
  alertIndex: number;
  candleCount: number;
}

/**
 * Check coverage for a batch of alerts in a single query.
 * Returns candle counts for each alert within their specific time windows.
 */
async function checkAlertCoverageBatch(
  client: ReturnType<CommandContext['services']['clickHouseClient']>,
  database: string,
  alerts: Array<{ index: number; mint: string; alertTsSec: number }>,
  intervalSeconds: number,
  horizonSeconds: number
): Promise<AlertCoverageResult[]> {
  if (alerts.length === 0) return [];

  // Build a UNION ALL query to check each alert's window
  // This is more efficient than individual queries
  const subqueries = alerts.map((alert, i) => {
    const startStr = toClickhouseDateTime(alert.alertTsSec);
    const endStr = toClickhouseDateTime(alert.alertTsSec + horizonSeconds);
    return `
      SELECT ${alert.index} as alert_idx, count() as cnt
      FROM ${database}.ohlcv_candles
      WHERE token_address = '${alert.mint}'
        AND interval_seconds = ${intervalSeconds}
        AND timestamp >= '${startStr}'
        AND timestamp < '${endStr}'
    `;
  });

  const query = subqueries.join(' UNION ALL ');
  const result = await client.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as Array<{ alert_idx: string; cnt: string }>;

  return rows.map((row) => ({
    alertIndex: Number(row.alert_idx),
    candleCount: Number(row.cnt),
  }));
}

async function fetchDashboardData(
  client: ReturnType<CommandContext['services']['clickHouseClient']>,
  database: string,
  alerts: Alert[],
  cachedCoverage: Map<string, Map<string, number>> // mint -> interval -> candleCount
): Promise<Omit<DashboardResult, 'dateRange'>> {
  // Get total candles (fast)
  const totalQuery = `SELECT count() as total FROM ${database}.ohlcv_candles`;
  const totalResult = await client.query({ query: totalQuery, format: 'JSONEachRow' });
  const totalRows = (await totalResult.json()) as Array<{ total: string }>;
  const totalCandles = Number(totalRows[0]?.total || 0);

  const intervals = [
    { name: '1m', seconds: 60 },
    { name: '5m', seconds: 300 },
  ];

  const results: IntervalCoverage[] = [];

  for (const interval of intervals) {
    const minSeconds = MIN_COVERAGE_SECONDS[interval.name];
    const minCandles = Math.floor(minSeconds / interval.seconds);

    // Group alerts by month
    const monthMap = new Map<string, { total: number; covered: number }>();
    let totalCovered = 0;

    // Check each alert against cached coverage
    for (const alert of alerts) {
      const intervalCache = cachedCoverage.get(alert.mint);
      const candleCount = intervalCache?.get(interval.name) ?? 0;
      const coverageSeconds = candleCount * interval.seconds;
      const isCovered = coverageSeconds >= minSeconds;

      // Update month stats
      if (!monthMap.has(alert.month)) {
        monthMap.set(alert.month, { total: 0, covered: 0 });
      }
      const monthStats = monthMap.get(alert.month)!;
      monthStats.total++;
      if (isCovered) {
        monthStats.covered++;
        totalCovered++;
      }
    }

    // Convert month map to array
    const monthlyBreakdown: MonthCoverage[] = Array.from(monthMap.entries())
      .map(([month, stats]) => ({
        month,
        totalAlerts: stats.total,
        coveredAlerts: stats.covered,
        percent: stats.total > 0 ? (stats.covered / stats.total) * 100 : 0,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));

    results.push({
      interval: interval.name,
      intervalSeconds: interval.seconds,
      minCoverageSeconds: minSeconds,
      minCoverageCandles: minCandles,
      totalAlerts: alerts.length,
      coveredAlerts: totalCovered,
      percent: alerts.length > 0 ? (totalCovered / alerts.length) * 100 : 0,
      monthlyBreakdown,
    });
  }

  const uniqueTokens = new Set(alerts.map((a) => a.mint)).size;

  return {
    totalCandles,
    totalAlerts: alerts.length,
    uniqueTokens,
    intervals: results,
    timestamp: dt.now().toISO() ?? new Date().toISOString(),
  };
}

function renderDashboard(data: DashboardResult): void {
  // Clear screen and move cursor to top
  process.stdout.write('\x1b[2J\x1b[H');

  const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
  };

  console.log('');
  console.log(
    `${c.bold}${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`
  );
  console.log(`${c.bold}${c.cyan}  📊 OHLCV Coverage Dashboard (Alert-Centric)${c.reset}`);
  console.log(`${c.gray}  Date Range: ${data.dateRange.from} → ${data.dateRange.to}${c.reset}`);
  console.log(`${c.gray}  Last updated: ${data.timestamp}${c.reset}`);
  console.log(
    `${c.bold}${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`
  );
  console.log('');

  console.log(
    `${c.bold}Candles in ClickHouse: ${c.cyan}${data.totalCandles.toLocaleString()}${c.reset}`
  );
  console.log(
    `${c.bold}Alerts: ${c.cyan}${data.totalAlerts.toLocaleString()}${c.reset} (${data.uniqueTokens.toLocaleString()} unique tokens)`
  );
  console.log('');

  // Overall coverage bars
  for (const interval of data.intervals) {
    const thresholdStr = formatSeconds(interval.minCoverageSeconds);
    const label = `${interval.interval} Coverage: alerts with >= ${thresholdStr} sec from alert time`;
    console.log(`${c.bold}${label}${c.reset}`);
    console.log(
      `[${colorBar(interval.percent)}]  ${colorPercent(interval.percent)} (${interval.coveredAlerts.toLocaleString()} / ${interval.totalAlerts.toLocaleString()})`
    );
    console.log('');
  }

  console.log(`${c.bold}Monthly Coverage:${c.reset}`);
  console.log('');

  // Monthly breakdown for each interval
  for (const interval of data.intervals) {
    const thresholdStr = formatSeconds(interval.minCoverageSeconds);
    console.log(
      `${c.bold}${interval.interval} Interval (>= ${thresholdStr} sec from alert):${c.reset}`
    );
    for (const month of interval.monthlyBreakdown) {
      const bar = colorBar(month.percent);
      const covered = month.coveredAlerts.toString().padStart(4);
      const total = month.totalAlerts.toString().padStart(4);
      console.log(
        `${month.month} Alerts: ${total} ${bar} ${covered} / ${total} alerts ${colorPercent(month.percent)}`
      );
    }
    console.log('');
  }

  console.log(`${c.gray}Press Ctrl+C to exit. Refreshing every 5 seconds...${c.reset}`);
}

/**
 * Build per-alert coverage cache by querying ClickHouse for each alert's time window.
 */
async function buildAlertCoverageCache(
  client: ReturnType<CommandContext['services']['clickHouseClient']>,
  database: string,
  alerts: Alert[]
): Promise<Map<string, Map<string, number>>> {
  // Cache: alertKey (mint:alertTsMs) -> interval -> candleCount
  const cache = new Map<string, Map<string, number>>();

  const intervals = [
    { name: '1m', seconds: 60, horizon: MIN_COVERAGE_SECONDS['1m'] },
    { name: '5m', seconds: 300, horizon: MIN_COVERAGE_SECONDS['5m'] },
  ];

  const BATCH_SIZE = 50; // Keep batches small to avoid query timeout

  for (const interval of intervals) {
    console.log(`  Checking ${interval.name} coverage for ${alerts.length} alerts...`);

    for (let i = 0; i < alerts.length; i += BATCH_SIZE) {
      const batch = alerts.slice(i, i + BATCH_SIZE);
      const batchAlerts = batch.map((alert, batchIdx) => ({
        index: i + batchIdx,
        mint: alert.mint,
        alertTsSec: Math.floor(alert.alertTsMs / 1000),
      }));

      const results = await checkAlertCoverageBatch(
        client,
        database,
        batchAlerts,
        interval.seconds,
        interval.horizon
      );

      // Store results in cache
      for (const result of results) {
        const alert = alerts[result.alertIndex];
        const key = alert.mint; // Use mint as key since we want per-token coverage
        if (!cache.has(key)) {
          cache.set(key, new Map());
        }
        const intervalCache = cache.get(key)!;
        // Keep the max candle count for this token/interval (across all alerts for same token)
        const existing = intervalCache.get(interval.name) ?? 0;
        intervalCache.set(interval.name, Math.max(existing, result.candleCount));
      }

      // Progress indicator
      if ((i + BATCH_SIZE) % 200 === 0 || i + BATCH_SIZE >= alerts.length) {
        const progress = Math.min(i + BATCH_SIZE, alerts.length);
        process.stdout.write(`\r  ${interval.name}: ${progress}/${alerts.length} alerts checked`);
      }
    }
    console.log(''); // Newline after progress
  }

  return cache;
}

export async function coverageDashboardHandler(
  args: CoverageDashboardArgs,
  ctx: CommandContext
): Promise<DashboardResult> {
  const client = ctx.services.clickHouseClient();
  const database = process.env.CLICKHOUSE_DATABASE || 'quantbot';
  const { refreshInterval, duckdb, from, to } = args;

  console.log('Loading alerts from DuckDB...');

  // Fetch alerts from DuckDB (once, not on refresh)
  const worklistService = getDuckDBWorklistService();
  const worklist = await worklistService.queryWorklist({
    duckdbPath: duckdb,
    from,
    to,
    side: 'buy',
  });

  // Filter and transform alerts
  const alerts: Alert[] = worklist.calls
    .filter((a) => a.alertTsMs !== null && a.alertTsMs !== undefined)
    .map((a) => {
      const date = new Date(a.alertTsMs!);
      const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
      return {
        mint: a.mint,
        alertTsMs: a.alertTsMs!,
        month,
      };
    });

  console.log(`Found ${alerts.length} alerts. Building coverage cache...`);

  // Build per-alert coverage cache (this is the expensive part)
  const coverageCache = await buildAlertCoverageCache(client, database, alerts);

  console.log(`Coverage cache built for ${coverageCache.size} tokens. Starting dashboard...`);

  const dateRange = { from: from || 'all', to: to || 'now' };

  // Initial fetch
  let data = await fetchDashboardData(client, database, alerts, coverageCache);
  let fullData: DashboardResult = { ...data, dateRange };
  renderDashboard(fullData);

  // Set up refresh interval (just refreshes candle count, not coverage cache)
  const intervalId = setInterval(async () => {
    try {
      data = await fetchDashboardData(client, database, alerts, coverageCache);
      fullData = { ...data, dateRange };
      renderDashboard(fullData);
    } catch (error) {
      console.error('Error refreshing data:', error);
    }
  }, refreshInterval * 1000);

  // Handle Ctrl+C gracefully - return the promise that resolves on SIGINT
  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      clearInterval(intervalId);
      console.log('\n\nDashboard stopped.');
      resolve();
    });
  });

  return fullData;
}
