/**
 * Token Lifespan Analysis
 *
 * Determines if tokens with <2500 candles actually have "full coverage"
 * by checking if the OHLCV data spans the token's entire trading lifespan.
 *
 * Uses Birdeye's /defi/v3/search endpoint to get:
 * - creation_time: when the token was created
 * - last_trade_unix_time: when the token last traded
 *
 * A token is considered "effectively fully covered" if:
 * - We have OHLCV data from alertTime to either:
 *   a) The full 150k sec horizon (normal full coverage), OR
 *   b) The token's last_trade_unix_time (token is dead/inactive)
 */

import { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { getDuckDBWorklistService } from '@quantbot/storage';
import { getBirdeyeClient } from '@quantbot/api-clients';
import { dt } from '@quantbot/utils';

export const tokenLifespanSchema = z.object({
  duckdb: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  interval: z.enum(['1m', '5m']).default('1m'),
  minCoverageSeconds: z.coerce.number().int().default(150_000), // 150k sec for 1m
  concurrency: z.coerce.number().int().min(1).max(10).default(5), // API call concurrency
});

export type TokenLifespanArgs = z.infer<typeof tokenLifespanSchema>;

interface TokenInfo {
  mint: string;
  creationTime: string | null;
  creationTsMs: number | null;
  lastTradeUnixTime: number | null;
  lastTradeTsMs: number | null;
  liquidity: number | null;
  isActive: boolean; // True if last trade was within 24 hours
}

interface AlertCoverage {
  mint: string;
  alertTsMs: number;
  candleCount: number;
  coverageSeconds: number;
  hasFullCoverage: boolean;
  hasEffectiveFullCoverage: boolean; // True if we cover to token's last trade
  tokenLastTradeTsMs: number | null;
  reason: string; // Explanation for coverage status
}

interface LifespanResult {
  totalAlerts: number;
  originalFullCoverage: number;
  effectiveFullCoverage: number;
  improvementCount: number;
  activeTokensNotFullyCovered: number; // Tokens still trading but we don't have full coverage
  summary: {
    deadTokensFullyCovered: number;
    activeTokensFullyCovered: number;
    activeTokensPartial: number;
    unknownTokens: number;
  };
}

// Convert Unix seconds to ClickHouse DateTime string
function toClickhouseDateTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

export async function tokenLifespanHandler(
  args: TokenLifespanArgs,
  ctx: CommandContext
): Promise<LifespanResult> {
  const client = ctx.services.clickHouseClient();
  const birdeyeClient = getBirdeyeClient();
  const database = process.env.CLICKHOUSE_DATABASE || 'quantbot';
  const { duckdb, from, to, interval, minCoverageSeconds, concurrency } = args;

  const intervalSeconds = interval === '1m' ? 60 : 300;

  console.log(`Loading alerts from DuckDB...`);

  // Fetch alerts from DuckDB
  const worklistService = getDuckDBWorklistService();
  const worklist = await worklistService.queryWorklist({
    duckdbPath: duckdb,
    from,
    to,
    side: 'buy',
  });

  const alerts = worklist.calls
    .filter((a) => a.alertTsMs !== null)
    .map((a) => ({
      mint: a.mint,
      alertTsMs: a.alertTsMs!,
    }));

  console.log(`Found ${alerts.length} alerts.`);

  // Get unique mints
  const uniqueMints = [...new Set(alerts.map((a) => a.mint))];
  console.log(`${uniqueMints.length} unique tokens. Checking coverage...`);

  // First, get coverage from ClickHouse for all alerts
  const mintList = uniqueMints.map((m) => `'${m}'`).join(',');

  // Get candle counts per token from alertTime to alertTime + horizon
  const coverageMap = new Map<string, { candleCount: number; coverageSeconds: number }>();

  console.log(`Querying ClickHouse for coverage data...`);
  const BATCH_SIZE = 50;
  for (let i = 0; i < alerts.length; i += BATCH_SIZE) {
    const batch = alerts.slice(i, i + BATCH_SIZE);

    const subqueries = batch.map((alert) => {
      const alertTsSec = Math.floor(alert.alertTsMs / 1000);
      const endTsSec = alertTsSec + minCoverageSeconds;
      const startStr = toClickhouseDateTime(alertTsSec);
      const endStr = toClickhouseDateTime(endTsSec);

      return `
        SELECT 
          '${alert.mint}' as mint,
          ${alert.alertTsMs} as alert_ts_ms,
          count() as cnt
        FROM ${database}.ohlcv_candles
        WHERE token_address = '${alert.mint}'
          AND interval_seconds = ${intervalSeconds}
          AND timestamp >= '${startStr}'
          AND timestamp < '${endStr}'
      `;
    });

    const batchQuery = subqueries.join(' UNION ALL ');
    const result = await client.query({ query: batchQuery, format: 'JSONEachRow' });
    const rows = (await result.json()) as Array<{
      mint: string;
      alert_ts_ms: string;
      cnt: string;
    }>;

    for (const row of rows) {
      const key = `${row.mint}:${row.alert_ts_ms}`;
      const candleCount = Number(row.cnt);
      coverageMap.set(key, {
        candleCount,
        coverageSeconds: candleCount * intervalSeconds,
      });
    }

    if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= alerts.length) {
      console.log(`  Coverage query: ${Math.min(i + BATCH_SIZE, alerts.length)}/${alerts.length}`);
    }
  }

  // Identify tokens with insufficient coverage that need Birdeye lookup
  const tokensNeedingLookup = new Set<string>();
  for (const alert of alerts) {
    const key = `${alert.mint}:${alert.alertTsMs}`;
    const coverage = coverageMap.get(key);
    if (!coverage || coverage.coverageSeconds < minCoverageSeconds) {
      tokensNeedingLookup.add(alert.mint);
    }
  }

  console.log(
    `${tokensNeedingLookup.size} tokens have < ${minCoverageSeconds} sec coverage. Checking Birdeye for token lifespan...`
  );

  // Fetch token info from Birdeye for tokens with insufficient coverage
  const tokenInfoMap = new Map<string, TokenInfo>();
  const tokensToLookup = Array.from(tokensNeedingLookup);

  const nowMs = Date.now();
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

  for (let i = 0; i < tokensToLookup.length; i += concurrency) {
    const batch = tokensToLookup.slice(i, i + concurrency);

    const promises = batch.map(async (mint) => {
      try {
        // Determine chain from mint format
        const chain = mint.startsWith('0x') ? 'ethereum' : 'solana';
        const info = await birdeyeClient.searchToken(mint, chain);

        if (info) {
          let creationTsMs: number | null = null;
          if (info.creationTime) {
            creationTsMs = new Date(info.creationTime).getTime();
          }

          const lastTradeTsMs = info.lastTradeUnixTime ? info.lastTradeUnixTime * 1000 : null;
          const isActive = lastTradeTsMs ? nowMs - lastTradeTsMs < TWENTY_FOUR_HOURS_MS : false;

          tokenInfoMap.set(mint, {
            mint,
            creationTime: info.creationTime,
            creationTsMs,
            lastTradeUnixTime: info.lastTradeUnixTime,
            lastTradeTsMs,
            liquidity: info.liquidity,
            isActive,
          });
        }
      } catch {
        // Ignore errors for individual tokens
      }
    });

    await Promise.all(promises);

    // Progress and rate limiting
    if ((i + concurrency) % 50 === 0 || i + concurrency >= tokensToLookup.length) {
      console.log(`  Birdeye lookup: ${Math.min(i + concurrency, tokensToLookup.length)}/${tokensToLookup.length}`);
    }

    // Small delay between batches to respect rate limits
    if (i + concurrency < tokensToLookup.length) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  console.log(`Got Birdeye info for ${tokenInfoMap.size}/${tokensToLookup.length} tokens.`);

  // Now analyze coverage with lifespan data
  let originalFullCount = 0;
  let effectiveFullCount = 0;
  let improvementCount = 0;
  let deadTokensFullyCovered = 0;
  let activeTokensFullyCovered = 0;
  let activeTokensPartial = 0;
  let unknownTokens = 0;

  const coverageDetails: AlertCoverage[] = [];

  for (const alert of alerts) {
    const key = `${alert.mint}:${alert.alertTsMs}`;
    const coverage = coverageMap.get(key) || { candleCount: 0, coverageSeconds: 0 };
    const hasFullCoverage = coverage.coverageSeconds >= minCoverageSeconds;

    let hasEffectiveFullCoverage = hasFullCoverage;
    let reason = hasFullCoverage ? 'Full coverage (>= threshold)' : 'Insufficient coverage';
    let tokenLastTradeTsMs: number | null = null;

    if (!hasFullCoverage) {
      const tokenInfo = tokenInfoMap.get(alert.mint);

      if (tokenInfo) {
        tokenLastTradeTsMs = tokenInfo.lastTradeTsMs;

        if (tokenInfo.lastTradeTsMs) {
          // Check if our coverage extends to the token's last trade
          const alertTsSec = Math.floor(alert.alertTsMs / 1000);
          const ourCoverageEndsAtSec = alertTsSec + coverage.coverageSeconds;
          const tokenLastTradeSec = Math.floor(tokenInfo.lastTradeTsMs / 1000);

          if (ourCoverageEndsAtSec >= tokenLastTradeSec) {
            // We have all data from alert to token death
            hasEffectiveFullCoverage = true;
            reason = tokenInfo.isActive
              ? 'Coverage to last trade (token still active)'
              : 'Full lifespan covered (token inactive/dead)';

            if (!tokenInfo.isActive) {
              deadTokensFullyCovered++;
            } else {
              activeTokensFullyCovered++;
            }
          } else {
            // We don't have data to the last trade
            if (tokenInfo.isActive) {
              activeTokensPartial++;
              reason = 'Partial coverage (token still active, needs more data)';
            } else {
              reason = `Partial coverage (token dead, missing ${tokenLastTradeSec - ourCoverageEndsAtSec}s)`;
            }
          }
        } else {
          unknownTokens++;
          reason = 'Unknown lifespan (no Birdeye data)';
        }
      } else {
        unknownTokens++;
        reason = 'Unknown lifespan (Birdeye lookup failed)';
      }
    } else {
      // Already has full coverage
      activeTokensFullyCovered++;
    }

    if (hasFullCoverage) originalFullCount++;
    if (hasEffectiveFullCoverage) effectiveFullCount++;
    if (hasEffectiveFullCoverage && !hasFullCoverage) improvementCount++;

    coverageDetails.push({
      mint: alert.mint,
      alertTsMs: alert.alertTsMs,
      candleCount: coverage.candleCount,
      coverageSeconds: coverage.coverageSeconds,
      hasFullCoverage,
      hasEffectiveFullCoverage,
      tokenLastTradeTsMs,
      reason,
    });
  }

  // Summary
  const originalPct = ((originalFullCount / alerts.length) * 100).toFixed(1);
  const effectivePct = ((effectiveFullCount / alerts.length) * 100).toFixed(1);

  console.log('');
  console.log('='.repeat(70));
  console.log(`Token Lifespan Analysis - ${interval} Interval`);
  console.log('='.repeat(70));
  console.log(`Total alerts: ${alerts.length}`);
  console.log(`Original full coverage (>= ${minCoverageSeconds} sec): ${originalFullCount} (${originalPct}%)`);
  console.log(`Effective full coverage (incl. dead tokens): ${effectiveFullCount} (${effectivePct}%)`);
  console.log(`Improvement: +${improvementCount} alerts now considered fully covered`);
  console.log('');
  console.log('Breakdown:');
  console.log(`  Dead tokens fully covered: ${deadTokensFullyCovered}`);
  console.log(`  Active tokens fully covered: ${activeTokensFullyCovered}`);
  console.log(`  Active tokens partial coverage: ${activeTokensPartial}`);
  console.log(`  Unknown tokens (no Birdeye data): ${unknownTokens}`);
  console.log('');

  // Show some examples of "improved" tokens (dead tokens we now count as full)
  const deadFullyCovered = coverageDetails.filter(
    (c) => c.hasEffectiveFullCoverage && !c.hasFullCoverage && c.reason.includes('dead')
  );
  if (deadFullyCovered.length > 0) {
    console.log('Examples of dead tokens with effective full coverage:');
    for (const ex of deadFullyCovered.slice(0, 10)) {
      const alertDate = dt.fromTimestampMs(ex.alertTsMs).toFormat('yyyy-MM-dd');
      const lastTradeDate = ex.tokenLastTradeTsMs
        ? dt.fromTimestampMs(ex.tokenLastTradeTsMs).toFormat('yyyy-MM-dd')
        : 'N/A';
      console.log(`  ${ex.mint.slice(0, 20)}... alert: ${alertDate}, died: ${lastTradeDate}, candles: ${ex.candleCount}`);
    }
  }

  // Show tokens that still need more data
  const needsMoreData = coverageDetails.filter(
    (c) => !c.hasEffectiveFullCoverage && c.reason.includes('still active')
  );
  if (needsMoreData.length > 0) {
    console.log('');
    console.log(`Tokens needing more data (still active): ${needsMoreData.length}`);
  }

  return {
    totalAlerts: alerts.length,
    originalFullCoverage: originalFullCount,
    effectiveFullCoverage: effectiveFullCount,
    improvementCount,
    activeTokensNotFullyCovered: activeTokensPartial,
    summary: {
      deadTokensFullyCovered,
      activeTokensFullyCovered,
      activeTokensPartial,
      unknownTokens,
    },
  };
}
