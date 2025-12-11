#!/usr/bin/env ts-node
/**
 * Run simulations on all PostgreSQL alerts using ClickHouse OHLCV data
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { simulateStrategy } from '../packages/simulation/src/engine';
import { fetchHybridCandles } from '../packages/simulation/src/candles';
import { DateTime } from 'luxon';

const pgPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'quantbot',
  password: process.env.POSTGRES_PASSWORD || '',
  database: process.env.POSTGRES_DATABASE || 'quantbot',
});

// Default strategy: Simple multi-target
const DEFAULT_STRATEGY = [
  { percent: 0.5, target: 2.0 },
  { percent: 0.3, target: 3.0 },
  { percent: 0.2, target: 5.0 },
];

const DEFAULT_STOP_LOSS = {
  initial: -0.2,
  trailing: 'none' as const,
};

const DEFAULT_ENTRY = {
  initialEntry: 0.0, // Enter immediately at alert price
  trailingEntry: 'none' as const,
  maxWaitTime: 0,
};

const DEFAULT_COSTS = {
  entrySlippageBps: 300, // 3% = 300 basis points
  exitSlippageBps: 300,
  takerFeeBps: 50, // 0.5% = 50 basis points
  borrowAprBps: 0,
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

    // Fetch candles - fetchHybridCandles signature: (mint, startTime, endTime, chain, alertTime?)
    const candles = await fetchHybridCandles(
      token_address,
      startTime, // DateTime object
      endTime, // DateTime object
      'solana',
      alertTime // Optional DateTime for Ichimoku lookback
    );

    if (candles.length < 52) {
      console.log(`⏭️  Skipping alert ${alert_id}: insufficient candles (${candles.length})`);
      return;
    }

    // Run simulation
    const result = simulateStrategy(
      candles,
      DEFAULT_STRATEGY,
      DEFAULT_STOP_LOSS,
      DEFAULT_ENTRY,
      undefined, // reEntry
      DEFAULT_COSTS
    );

    // Calculate metrics from result
    const finalPrice = result.finalPrice;
    const maxPrice = Math.max(...candles.map(c => c.high));
    const pnl = (finalPrice / alert_price) - 1;
    const holdDurationMinutes = result.events.length > 0 
      ? Math.floor((result.events[result.events.length - 1].timestamp - result.events[0].timestamp) / 60)
      : 0;

    // Create table if it doesn't exist
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS simulation_results (
        id BIGSERIAL PRIMARY KEY,
        alert_id BIGINT NOT NULL,
        token_address TEXT NOT NULL,
        chain TEXT NOT NULL,
        caller_name TEXT,
        alert_timestamp TIMESTAMPTZ NOT NULL,
        entry_price NUMERIC(38, 18) NOT NULL,
        exit_price NUMERIC(38, 18) NOT NULL,
        pnl NUMERIC(10, 4) NOT NULL,
        max_reached NUMERIC(38, 18),
        hold_duration_minutes INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(alert_id)
      )
    `);

    // Save to PostgreSQL
    await pgPool.query(`
      INSERT INTO simulation_results (
        alert_id, token_address, chain, caller_name, 
        alert_timestamp, entry_price, exit_price, pnl, 
        max_reached, hold_duration_minutes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (alert_id) DO UPDATE SET
        exit_price = EXCLUDED.exit_price,
        pnl = EXCLUDED.pnl,
        max_reached = EXCLUDED.max_reached,
        hold_duration_minutes = EXCLUDED.hold_duration_minutes,
        updated_at = NOW()
    `, [
      alert_id, token_address, chain, alert.caller_name || 'unknown',
      alertTime.toJSDate(), alert_price, finalPrice, pnl,
      maxPrice, holdDurationMinutes
    ]);

    console.log(`✅ Alert ${alert_id}: PNL ${(pnl * 100).toFixed(2)}%, Max ${maxPrice.toFixed(6)}`);

  } catch (error: any) {
    console.error(`❌ Error processing alert ${alert.id}:`, error.message);
  }
}

async function main() {
  console.log('🚀 Starting simulations on PostgreSQL alerts...\n');

  // Get all alerts with prices that don't have simulation results yet
  const result = await pgPool.query(`
    SELECT 
      a.id,
      a.token_id,
      a.alert_timestamp,
      a.alert_price,
      COALESCE(c.handle, 'unknown') as caller_name,
      t.address as token_address,
      t.chain
    FROM alerts a
    JOIN tokens t ON t.id = a.token_id
    LEFT JOIN callers c ON c.id = a.caller_id
    WHERE a.alert_price IS NOT NULL
    AND a.alert_price > 0
    AND t.chain = 'solana'
    AND NOT EXISTS (
      SELECT 1 FROM simulation_results sr WHERE sr.alert_id = a.id
    )
    ORDER BY a.alert_timestamp DESC
    LIMIT 5000
  `, []);

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

