#!/usr/bin/env ts-node
/**
 * Analyze OHLCV data coverage - identify which alerts are missing historical data
 */

import 'dotenv/config';
import { Pool } from 'pg';

const pgPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'quantbot',
  password: process.env.POSTGRES_PASSWORD || '',
  database: process.env.POSTGRES_DATABASE || 'quantbot',
});

async function analyzeCoverage() {
  console.log('📊 Analyzing OHLCV data coverage...\n');

  // Get simulation results with alert timestamps
  const result = await pgPool.query(`
    SELECT 
      sr.alert_id,
      sr.token_address,
      a.alert_timestamp,
      a.alert_price,
      t.created_at as token_first_seen,
      EXTRACT(EPOCH FROM (a.alert_timestamp - t.created_at)) / 60 as minutes_between_token_creation_and_alert
    FROM simulation_results sr
    JOIN alerts a ON a.id = sr.alert_id
    JOIN tokens t ON t.id = a.token_id
    WHERE a.alert_timestamp >= NOW() - INTERVAL '90 days'
    ORDER BY a.alert_timestamp DESC
    LIMIT 200
  `);

  console.log(`📈 Analyzing ${result.rows.length} simulation results...\n`);

  const insufficient = result.rows.filter(r => {
    const minutesBefore = r.minutes_between_token_creation_and_alert;
    return minutesBefore < 260; // 52 periods * 5 minutes = 260 minutes
  });

  const sufficient = result.rows.filter(r => {
    const minutesBefore = r.minutes_between_token_creation_and_alert;
    return minutesBefore >= 260;
  });

  console.log('📊 Coverage Analysis:');
  console.log(`  ✅ Sufficient history (≥260 min): ${sufficient.length} (${((sufficient.length / result.rows.length) * 100).toFixed(1)}%)`);
  console.log(`  ⚠️  Insufficient history (<260 min): ${insufficient.length} (${((insufficient.length / result.rows.length) * 100).toFixed(1)}%)`);

  if (insufficient.length > 0) {
    console.log('\n⚠️  Alerts with insufficient history:');
    const byRange = {
      '0-60 min': insufficient.filter(r => r.minutes_between_token_creation_and_alert < 60).length,
      '60-120 min': insufficient.filter(r => r.minutes_between_token_creation_and_alert >= 60 && r.minutes_between_token_creation_and_alert < 120).length,
      '120-180 min': insufficient.filter(r => r.minutes_between_token_creation_and_alert >= 120 && r.minutes_between_token_creation_and_alert < 180).length,
      '180-260 min': insufficient.filter(r => r.minutes_between_token_creation_and_alert >= 180 && r.minutes_between_token_creation_and_alert < 260).length,
    };
    Object.entries(byRange).forEach(([range, count]) => {
      if (count > 0) {
        console.log(`    ${range}: ${count} alerts`);
      }
    });
  }

  // Check ClickHouse data availability
  console.log('\n🔍 Sample alerts with insufficient history:');
  const sampleInsufficient = insufficient.slice(0, 5);
  for (const row of sampleInsufficient) {
    const minutes = parseFloat(row.minutes_between_token_creation_and_alert) || 0;
    console.log(`  Alert ${row.alert_id}: Token created ${minutes.toFixed(1)} min before alert (need 260 min)`);
  }

  await pgPool.end();
}

if (require.main === module) {
  analyzeCoverage()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('\n❌ Fatal error:', error);
      process.exit(1);
    });
}

export { analyzeCoverage };

