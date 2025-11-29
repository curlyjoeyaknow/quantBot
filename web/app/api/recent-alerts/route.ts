import { NextRequest, NextResponse } from 'next/server';
import { promisify } from 'util';
import { dbManager } from '@/lib/db-manager';
import { queryCandlesBatch } from '@/lib/clickhouse';
import { cache, cacheKeys } from '@/lib/cache';
import { getCurrentPricesBatch } from '@/lib/birdeye-api';
import { CONSTANTS } from '@/lib/constants';
import { simulateTenkanKijunRemainingPeriodOnly } from '@/lib/strategy';
import { calculateMarketCapsBatch } from '@/lib/market-cap';
import { strategyResultsDb } from '@/lib/jobs/strategy-results-db';
import { withErrorHandling } from '@/lib/middleware/error-handler';
import { rateLimit, RATE_LIMITS } from '@/lib/middleware/rate-limit';

interface RecentAlertRow {
  id: number;
  callerName: string;
  tokenAddress: string;
  tokenSymbol?: string;
  chain: string;
  alertTimestamp: string;
  priceAtAlert?: number;
  entryPrice?: number;
  marketCapAtCall?: number;
  maxPrice?: number;
  maxGainPercent?: number;
  timeToATH?: number;
  isDuplicate: boolean;
  currentPrice?: number;
  currentGainPercent?: number;
}

const getRecentAlertsHandler = async (request: NextRequest) => {
    const db = await dbManager.getDatabase();
    const all = promisify(db.all.bind(db)) as (query: string, params?: any[]) => Promise<any[]>;

    // Get pagination params
    const page = Math.max(1, parseInt(request.nextUrl.searchParams.get('page') || '1'));
    const pageSize = Math.min(
      CONSTANTS.REQUEST.MAX_PAGE_SIZE,
      Math.max(1, parseInt(request.nextUrl.searchParams.get('pageSize') || '100'))
    );

    // Get alerts from past week
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const oneWeekAgoISO = oneWeekAgo.toISOString();

    // Get total count
    const countResult = await all(
      `SELECT COUNT(*) as count FROM caller_alerts WHERE alert_timestamp >= ?`,
      [oneWeekAgoISO]
    ) as any[];
    const total = countResult[0]?.count || 0;

    // Get paginated rows
    const rows = await all(
      `SELECT * FROM caller_alerts 
       WHERE alert_timestamp >= ? 
       ORDER BY alert_timestamp DESC
       LIMIT ? OFFSET ?`,
      [oneWeekAgoISO, pageSize, (page - 1) * pageSize]
    ) as any[];

    // Batch duplicate checks
    const duplicateChecks = await Promise.all(
      rows.map(async (row) => {
        const duplicateCheck = await all(
          `SELECT COUNT(*) as count FROM caller_alerts 
           WHERE token_address = ? 
           AND caller_name = ?
           AND alert_timestamp BETWEEN datetime(?, '-1 day') AND datetime(?, '+1 day')
           AND id != ?`,
          [row.token_address, row.caller_name, row.alert_timestamp, row.alert_timestamp, row.id]
        ) as any[];
        return {
          id: row.id,
          isDuplicate: (duplicateCheck[0]?.count || 0) > 0, // Fixed: count > 0 instead of > 1
        };
      })
    );
    const duplicateMap = new Map(duplicateChecks.map(d => [d.id, d.isDuplicate]));

    // Batch OHLCV queries
    const ohlcvQueries = rows.map((row) => {
      const alertTime = new Date(row.alert_timestamp);
      const endTime = new Date(alertTime.getTime() + CONSTANTS.DAYS_7_MS);
      return {
        tokenAddress: row.token_address,
        chain: row.chain || 'solana',
        startTime: alertTime,
        endTime: endTime,
        interval: '5m',
        rowId: row.id,
      };
    });

    // Check cache and batch query
    const ohlcvResults = new Map<number, any[]>();
    const uncachedQueries: typeof ohlcvQueries = [];

    for (const q of ohlcvQueries) {
      const cacheKey = cacheKeys.ohlcv(
        q.tokenAddress,
        q.chain,
        q.startTime.toISOString(),
        q.endTime.toISOString(),
        q.interval
      );
      const cached = cache.get<any[]>(cacheKey);
      if (cached) {
        ohlcvResults.set(q.rowId, cached);
      } else {
        uncachedQueries.push(q);
      }
    }

    if (uncachedQueries.length > 0) {
      const batchResults = await queryCandlesBatch(
        uncachedQueries.map(q => ({
          tokenAddress: q.tokenAddress,
          chain: q.chain,
          startTime: q.startTime,
          endTime: q.endTime,
          interval: q.interval,
        }))
      );

      uncachedQueries.forEach((q) => {
        const cacheKey = cacheKeys.ohlcv(
          q.tokenAddress,
          q.chain,
          q.startTime.toISOString(),
          q.endTime.toISOString(),
          q.interval
        );
        const key = `${q.chain}:${q.tokenAddress}:${q.startTime.getTime()}:${q.endTime.getTime()}`;
        const candles = batchResults.get(key) || [];
        cache.set(cacheKey, candles, CONSTANTS.CACHE_TTL.OHLCV);
        ohlcvResults.set(q.rowId, candles);
      });
    }

    // Try to get pre-computed strategy results first
    const strategyResults = new Map<number, ReturnType<typeof simulateTenkanKijunRemainingPeriodOnly>>();
    const precomputedResults = await Promise.all(
      rows.map(async (row) => {
        const precomputed = await strategyResultsDb.getResult(row.id);
        return { id: row.id, result: precomputed };
      })
    );

    // Use pre-computed results where available
    for (const { id, result } of precomputedResults) {
      if (result) {
        strategyResults.set(id, {
          pnl: result.pnl,
          maxReached: result.max_reached,
          holdDuration: result.hold_duration_minutes,
          entryTime: result.entry_time,
          exitTime: result.exit_time,
          entryPrice: result.entry_price,
        });
      }
    }

    // Compute missing results on-demand (fallback)
    for (const row of rows) {
      if (strategyResults.has(row.id)) continue; // Skip if already computed

      const candles = ohlcvResults.get(row.id) || [];
      if (candles.length >= 52) {
        const alertTime = new Date(row.alert_timestamp);
        const formattedCandles = candles.map((c: any) => ({
          timestamp: c.timestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }));
        const result = simulateTenkanKijunRemainingPeriodOnly(formattedCandles, alertTime);
        if (result) {
          strategyResults.set(row.id, result);
          // Save for future use (async, don't wait)
          strategyResultsDb.saveResult({
            alert_id: row.id,
            token_address: row.token_address,
            chain: row.chain || 'solana',
            caller_name: row.caller_name,
            alert_timestamp: row.alert_timestamp,
            entry_price: result.entryPrice,
            exit_price: result.entryPrice * result.pnl,
            pnl: result.pnl,
            max_reached: result.maxReached,
            hold_duration_minutes: result.holdDuration,
            entry_time: result.entryTime,
            exit_time: result.exitTime,
            computed_at: new Date().toISOString(),
          }).catch(err => console.error('Error saving strategy result:', err));
        }
      }
    }

    // Batch current price lookups
    const priceRequests = rows.map(row => ({
      tokenAddress: row.token_address,
      chain: row.chain || 'solana',
    }));
    const currentPrices = await getCurrentPricesBatch(priceRequests);

    // Batch calculate market caps
    const marketCapRequests = rows
      .filter(row => row.price_at_alert && row.price_at_alert > 0)
      .map(row => ({
        tokenAddress: row.token_address,
        chain: row.chain || 'solana',
        price: row.price_at_alert,
        timestamp: row.alert_timestamp,
      }));
    const marketCaps = await calculateMarketCapsBatch(marketCapRequests);
    const marketCapMap = new Map<string, number | null>();
    marketCaps.forEach((value, key) => {
      marketCapMap.set(key, value);
    });

    // Enrich rows
    const enrichedRows: RecentAlertRow[] = rows.map((row) => {
      const alertTime = new Date(row.alert_timestamp);
      const candles = ohlcvResults.get(row.id) || [];
      const isDuplicate = duplicateMap.get(row.id) || false;
      const priceKey = `${row.chain || 'solana'}:${row.token_address}`;
      const currentPrice = currentPrices.get(priceKey) || undefined;
      const strategyResult = strategyResults.get(row.id);

      // Use strategy result if available
      let entryPrice = row.price_at_alert;
      let maxPrice = row.price_at_alert;
      let maxGainPercent = 0;
      let timeToATH = null;

      if (strategyResult) {
        entryPrice = strategyResult.entryPrice;
        maxPrice = entryPrice * strategyResult.maxReached;
        maxGainPercent = (strategyResult.maxReached - 1) * 100;
        if (strategyResult.maxReached > 1.0) {
          const entryTime = strategyResult.entryTime;
          const exitTime = strategyResult.exitTime;
          const estimatedATHTime = entryTime + (exitTime - entryTime) * 0.3;
          timeToATH = Math.round((estimatedATHTime - alertTime.getTime()) / (60 * 1000));
        }
      } else if (candles.length > 0) {
        // Fallback calculation
        entryPrice = candles[0]?.close || row.price_at_alert;
        let maxPriceValue = entryPrice;
        let athTimestamp = alertTime.getTime();
        for (const candle of candles) {
          const candleHigh = candle.high || 0;
          if (candleHigh > maxPriceValue) {
            maxPriceValue = candleHigh;
            const candleTime = candle.timestamp
              ? typeof candle.timestamp === 'number'
                ? candle.timestamp * 1000
                : new Date(candle.timestamp).getTime()
              : alertTime.getTime();
            athTimestamp = candleTime;
          }
        }
        maxPrice = maxPriceValue;
        maxGainPercent = entryPrice > 0 ? ((maxPrice / entryPrice) - 1) * 100 : 0;
        timeToATH = Math.round((athTimestamp - alertTime.getTime()) / (60 * 1000));
      }

      const currentGainPercent = entryPrice && currentPrice
        ? ((currentPrice / entryPrice) - 1) * 100
        : undefined;

      const marketCapKey = `${row.chain || 'solana'}:${row.token_address}:${row.alert_timestamp}`;
      const marketCapAtCall = marketCapMap.get(marketCapKey) || undefined;

      return {
        id: row.id,
        callerName: row.caller_name,
        tokenAddress: row.token_address,
        tokenSymbol: row.token_symbol,
        chain: row.chain,
        alertTimestamp: row.alert_timestamp,
        priceAtAlert: row.price_at_alert,
        entryPrice,
        marketCapAtCall,
        maxPrice,
        maxGainPercent,
        timeToATH: timeToATH ?? undefined,
        isDuplicate,
        currentPrice,
        currentGainPercent,
      };
    });

  return NextResponse.json({ 
    data: enrichedRows,
    total,
    page,
    pageSize,
  });
};

export const GET = rateLimit(RATE_LIMITS.STANDARD)(
  withErrorHandling(getRecentAlertsHandler)
);
