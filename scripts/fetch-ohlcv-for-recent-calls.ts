#!/usr/bin/env ts-node

/**
 * Fetch OHLCV Historical Candles for Most Recent Calls
 * 
 * This script fetches historical candles for the most recent alerts/calls,
 * processing them in order from newest to oldest.
 * 
 * Usage:
 *   ts-node scripts/fetch-ohlcv-for-recent-calls.ts [limit]
 * 
 * Example:
 *   ts-node scripts/fetch-ohlcv-for-recent-calls.ts 100
 */

import { config } from 'dotenv';
config({ override: true });

import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../packages/simulation/src/candles';
import { logger } from '../packages/utils/src/logger';
import { postgresManager } from '../packages/web/lib/db/postgres-manager';

interface RecentAlert {
  id: number;
  tokenAddress: string;
  tokenSymbol: string;
  chain: string;
  callerName: string;
  alertTimestamp: Date;
  priceAtAlert?: number;
  side?: string;
  confidence?: number;
  message?: string;
}

/**
 * Get recent alerts from PostgreSQL database, ordered by newest first
 */
async function getRecentAlerts(limit: number = 100): Promise<RecentAlert[]> {
  try {
    const result = await postgresManager.query(
      `
      SELECT 
        a.id,
        t.address as token_address,
        t.symbol as token_symbol,
        t.chain,
        c.handle as caller_handle,
        a.alert_timestamp,
        a.alert_price,
        a.side,
        a.confidence,
        (a.raw_payload_json->>'message') as alert_message
      FROM alerts a
      LEFT JOIN tokens t ON t.id = a.token_id
      LEFT JOIN callers c ON c.id = a.caller_id
      WHERE t.address IS NOT NULL
        AND t.chain IS NOT NULL
        AND a.alert_timestamp IS NOT NULL
      ORDER BY a.alert_timestamp DESC
      LIMIT $1
      `,
      [limit]
    );

    return result.rows.map((row: any) => ({
      id: row.id,
      tokenAddress: row.token_address,
      tokenSymbol: row.token_symbol,
      chain: row.chain || 'solana',
      callerName: row.caller_handle,
      alertTimestamp: row.alert_timestamp,
      priceAtAlert: row.alert_price ? parseFloat(row.alert_price) : undefined,
      side: row.side,
      confidence: row.confidence ? parseFloat(row.confidence) : undefined,
      message: row.alert_message,
    }));
  } catch (error) {
    logger.error('Error fetching recent alerts from database', error as Error);
    throw error;
  }
}

/**
 * Fetch candles for a single alert
 */
async function fetchCandlesForAlert(alert: RecentAlert): Promise<void> {
  const alertTime = DateTime.fromJSDate(alert.alertTimestamp);
  const endTime = DateTime.utc();
  
  // Calculate start time: go back enough to get historical data
  // For Ichimoku, we need at least 52 periods (260 minutes = 4.33 hours) before alert
  // But we'll fetch more to get full history
  const startTime = alertTime.minus({ hours: 24 }); // Start 24 hours before alert for good coverage
  
  logger.info(`Fetching candles for alert ${alert.id}`, {
    token: alert.tokenAddress.substring(0, 20),
    symbol: alert.tokenSymbol,
    chain: alert.chain,
    caller: alert.callerName,
    alertTime: alertTime.toISO(),
    startTime: startTime.toISO(),
    endTime: endTime.toISO(),
  });

  try {
    const candles = await fetchHybridCandles(
      alert.tokenAddress, // Full mint address - never concatenate!
      startTime,
      endTime,
      alert.chain,
      alertTime // Pass alertTime to ensure 52-period lookback and 1m candles
    );

    logger.info(`✅ Successfully fetched ${candles.length} candles for alert ${alert.id}`, {
      token: alert.tokenAddress.substring(0, 20),
      symbol: alert.tokenSymbol,
      candlesCount: candles.length,
      timeRange: candles.length > 0
        ? `${new Date(candles[0].timestamp * 1000).toISOString()} to ${new Date(candles[candles.length - 1].timestamp * 1000).toISOString()}`
        : 'N/A',
    });

    return;
  } catch (error: any) {
    logger.error(`❌ Failed to fetch candles for alert ${alert.id}`, error as Error, {
      token: alert.tokenAddress.substring(0, 20),
      symbol: alert.tokenSymbol,
      chain: alert.chain,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Main execution function
 */
async function main() {
  const limit = process.argv[2] ? parseInt(process.argv[2], 10) : 100;
  
  if (isNaN(limit) || limit <= 0) {
    logger.error('Invalid limit provided. Must be a positive number.');
    process.exit(1);
  }

  logger.info(`Starting OHLCV fetch for most recent ${limit} calls`, { limit });

  try {
    // Get recent alerts (newest first)
    const alerts = await getRecentAlerts(limit);
    
    if (alerts.length === 0) {
      logger.warn('No alerts found in database');
      process.exit(0);
    }

    logger.info(`Found ${alerts.length} recent alerts, processing from newest to oldest`);

    // Process alerts in order (newest first)
    let successCount = 0;
    let failureCount = 0;
    const errors: Array<{ alert: RecentAlert; error: string }> = [];

    for (let i = 0; i < alerts.length; i++) {
      const alert = alerts[i];
      const progress = `[${i + 1}/${alerts.length}]`;
      
      logger.info(`${progress} Processing alert ${alert.id} (${alert.tokenSymbol || 'N/A'}) from ${alert.callerName || 'Unknown'}`);

      try {
        await fetchCandlesForAlert(alert);
        successCount++;
        
        // Small delay between requests to avoid rate limits
        if (i < alerts.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error: any) {
        failureCount++;
        errors.push({
          alert,
          error: error.message || String(error),
        });
        
        // Continue processing other alerts even if one fails
        logger.warn(`${progress} Failed to process alert ${alert.id}, continuing...`);
      }
    }

    // Summary
    logger.info('✅ OHLCV fetch complete', {
      total: alerts.length,
      success: successCount,
      failures: failureCount,
      successRate: `${((successCount / alerts.length) * 100).toFixed(1)}%`,
    });

    if (errors.length > 0) {
      logger.warn('Failed alerts:', {
        count: errors.length,
        errors: errors.slice(0, 10).map(e => ({
          alertId: e.alert.id,
          token: e.alert.tokenAddress.substring(0, 20),
          error: e.error,
        })),
      });
    }

    process.exit(failureCount > 0 ? 1 : 0);
  } catch (error) {
    logger.error('Fatal error in main execution', error as Error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    logger.error('Unhandled error', error as Error);
    process.exit(1);
  });
}

