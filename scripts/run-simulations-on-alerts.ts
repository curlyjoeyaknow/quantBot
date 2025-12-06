#!/usr/bin/env ts-node
/**
 * Run simulations on all PostgreSQL alerts using ClickHouse OHLCV data
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { SimulationEngine, simulateStrategy } from '@quantbot/simulation';
import { fetchHybridCandles } from '@quantbot/simulation';
import { DateTime } from 'luxon';

const pgPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'quantbot',
  password: process.env.POSTGRES_PASSWORD || '',
  database: process.env.POSTGRES_DATABASE || 'quantbot',
});

// Default strategy: Tenkan/Kijun with remaining period
const DEFAULT_STRATEGY = {
  entry: {
    type: 'at_alert' as const,
  },
  exit: {
    type: 'tenkan_kijun_remaining_period' as const,
    config: {
      remainingPeriods: 26,
    },
  },
  stopLoss: {
    initial: -0.2,
    trailing: 'none' as const,
  },
  takeProfit: [
    { percent: 0.5, target: 2.0 },
    { percent: 0.3, target: 3.0 },
    { percent: 0.2, target: 5.0 },
  ],
  positionSize: 0.025, // 2.5% of portfolio
  slippage: 0.03,
  fees: 0.005,
};

async function runSimulationOnAlert(alert: any): Promise<void> {
  try {
    const { token_address, chain, alert_timestamp, alert_price, id: alert_id } = alert;
    
    if (!alert_price || alert_price <= 0) {
      console.log(`⏭️  Skipping alert ${alert_id}: no price`);
      return;
    }

    // Calculate time range: 52 periods before alert + 7 days after
    const alertTime = DateTime.fromJSDate(new Date(alert_timestamp));
    const startTime = alertTime.minus({ minutes: 52 * 5 }); // 52 5m periods before
    const endTime = alertTime.plus({ days: 7 }); // 7 days after

    console.log(`🔄 Processing alert ${alert_id}: ${token_address.substring(0, 8)}...`);

    // Fetch candles
    const candles = await fetchHybridCandles(
      token_address,
      alertTime,
      startTime.toUnixInteger(),
      endTime.toUnixInteger(),
      'solana'
    );

    if (candles.length < 52) {
      console.log(`⏭️  Skipping alert ${alert_id}: insufficient candles (${candles.length})`);
      return;
    }

    // Run simulation
    const result = await simulateStrategy({
      candles,
      entryPrice: alert_price,
      entryTime: alertTime.toJSDate(),
      strategy: DEFAULT_STRATEGY,
      initialBalance: 100, // 100 SOL
    });

    // Save to PostgreSQL
    await insertSimulationResult({
      alert_id,
      token_address,
      chain,
      caller_name: alert.caller_name || 'unknown',
      alert_timestamp: alertTime.toJSDate(),
      entry_price: alert_price,
      exit_price: result.exitPrice || alert_price,
      pnl: result.pnl,
      max_reached: result.maxPrice || alert_price,
      hold_duration_minutes: result.holdDurationMinutes || 0,
      trades: result.trades || [],
    });

    console.log(`✅ Alert ${alert_id}: PNL ${result.pnl.toFixed(2)}x, Max ${result.maxPrice?.toFixed(4) || 'N/A'}`);

  } catch (error: any) {
    console.error(`❌ Error processing alert ${alert.id}:`, error.message);
  }
}

async function main() {
  console.log('🚀 Starting simulations on PostgreSQL alerts...\n');

  // Get alerts with prices from last 30 days
  const thirtyDaysAgo = DateTime.now().minus({ days: 30 }).toJSDate();
  
  const result = await pgPool.query(`
    SELECT 
      a.id,
      a.token_id,
      a.alert_timestamp,
      a.alert_price,
      a.caller_name,
      t.address as token_address,
      t.chain
    FROM alerts a
    JOIN tokens t ON t.id = a.token_id
    WHERE a.alert_price IS NOT NULL
    AND a.alert_price > 0
    AND a.alert_timestamp >= $1
    AND t.chain = 'solana'
    ORDER BY a.alert_timestamp DESC
    LIMIT 100
  `, [thirtyDaysAgo]);

  console.log(`📊 Found ${result.rows.length} alerts to simulate\n`);

  let processed = 0;
  let success = 0;
  let failed = 0;

  for (const alert of result.rows) {
    try {
      await runSimulationOnAlert(alert);
      success++;
    } catch (error: any) {
      console.error(`Failed alert ${alert.id}:`, error.message);
      failed++;
    }
    processed++;
    
    if (processed % 10 === 0) {
      console.log(`\n📈 Progress: ${processed}/${result.rows.length} (${success} success, ${failed} failed)\n`);
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`\n✅ Complete: ${success} successful, ${failed} failed out of ${processed} total`);
  
  await pgPool.end();
  process.exit(0);
}

main().catch(console.error);

