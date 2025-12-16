#!/usr/bin/env ts-node

/**
 * Query ingestion statistics and sample data
 */

import 'tsconfig-paths/register';
import { getPostgresPool } from '@quantbot/storage';

async function queryStats() {
  const pool = getPostgresPool();

  try {
    // Counts
    console.log('\n📊 Database Counts:');
    console.log('='.repeat(80));

    const alerts = await pool.query(
      "SELECT COUNT(*) as count FROM alerts WHERE raw_payload_json->>'botMessageId' IS NOT NULL"
    );
    const calls = await pool.query('SELECT COUNT(*) as count FROM calls');
    const tokens = await pool.query('SELECT COUNT(*) as count FROM tokens');
    const tokenData = await pool.query('SELECT COUNT(*) as count FROM token_data');

    console.log(`Alerts: ${alerts.rows[0].count}`);
    console.log(`Calls: ${calls.rows[0].count}`);
    console.log(`Tokens: ${tokens.rows[0].count}`);
    console.log(`Token Data: ${tokenData.rows[0].count}`);

    // Comparison with ingestion results
    console.log('\n📈 Comparison:');
    console.log('='.repeat(80));
    console.log('From ingestion run:');
    console.log('  Bot messages found: 337');
    console.log('  Bot messages processed: 288');
    console.log('  Alerts inserted: 288');
    console.log('  Calls inserted: 288');
    console.log('  Tokens upserted: 133');
    console.log(`\nIn database:`);
    console.log(`  Alerts: ${alerts.rows[0].count}`);
    console.log(`  Calls: ${calls.rows[0].count}`);
    console.log(`  Tokens: ${tokens.rows[0].count}`);
    console.log(`  Token Data: ${tokenData.rows[0].count}`);

    // Sample alerts
    console.log('\n📝 Sample Alerts (last 10):');
    console.log('='.repeat(80));
    const sampleAlerts = await pool.query(`
      SELECT 
        a.id,
        a.alert_timestamp,
        a.initial_price,
        a.initial_mcap,
        a.first_caller,
        a.raw_payload_json->>'callerMessageText' as caller_text,
        a.raw_payload_json->>'ticker' as ticker,
        a.raw_payload_json->>'tokenName' as token_name,
        t.address,
        t.symbol,
        COALESCE(c.display_name, c.handle) as caller_name
      FROM alerts a
      JOIN tokens t ON a.token_id = t.id
      JOIN callers c ON a.caller_id = c.id
      WHERE a.raw_payload_json->>'botMessageId' IS NOT NULL
      ORDER BY a.alert_timestamp DESC
      LIMIT 10
    `);

    for (const row of sampleAlerts.rows) {
      console.log(`\n[${row.id}] ${row.ticker || row.symbol} - ${row.token_name || 'N/A'}`);
      console.log(`   Caller: ${row.caller_name}`);
      console.log(`   Address: ${row.address.substring(0, 20)}...`);
      console.log(`   Alert Time: ${row.alert_timestamp}`);
      console.log(`   Price: $${row.initial_price}`);
      console.log(`   MCap: $${row.initial_mcap?.toLocaleString()}`);
      console.log(`   First Caller: ${row.first_caller}`);
      console.log(
        `   Caller Text: ${(row.caller_text || '').substring(0, 100)}${row.caller_text && row.caller_text.length > 100 ? '...' : ''}`
      );
    }

    // Sample token data
    console.log('\n\n💾 Sample Token Data (last 10):');
    console.log('='.repeat(80));
    const sampleTokenData = await pool.query(`
      SELECT 
        td.id,
        td.recorded_at,
        td.price,
        td.market_cap,
        td.liquidity,
        td.volume,
        td.supply,
        td.ath_mcap,
        td.top_holders_percent,
        td.twitter_link,
        td.telegram_link,
        td.website_link,
        t.symbol,
        t.address
      FROM token_data td
      JOIN tokens t ON td.token_id = t.id
      ORDER BY td.recorded_at DESC
      LIMIT 10
    `);

    for (const row of sampleTokenData.rows) {
      console.log(`\n[${row.id}] ${row.symbol} - ${row.address.substring(0, 20)}...`);
      console.log(`   Recorded: ${row.recorded_at}`);
      console.log(`   Price: $${row.price}`);
      console.log(`   MCap: $${row.market_cap?.toLocaleString()}`);
      console.log(`   Liquidity: $${row.liquidity?.toLocaleString()}`);
      console.log(`   Volume: $${row.volume?.toLocaleString()}`);
      console.log(`   Supply: ${row.supply?.toLocaleString()}`);
      console.log(`   ATH MCap: $${row.ath_mcap?.toLocaleString()}`);
      console.log(`   TH %: ${row.top_holders_percent}%`);
      if (row.twitter_link) console.log(`   Twitter: ${row.twitter_link}`);
      if (row.telegram_link) console.log(`   Telegram: ${row.telegram_link}`);
      if (row.website_link) console.log(`   Website: ${row.website_link}`);
    }

    // Caller statistics
    console.log('\n\n👤 Caller Statistics:');
    console.log('='.repeat(80));
    const callerStats = await pool.query(`
      SELECT 
        COALESCE(c.display_name, c.handle) as caller_name,
        COUNT(DISTINCT a.id) as alert_count,
        COUNT(DISTINCT a.token_id) as unique_tokens,
        COUNT(DISTINCT CASE WHEN a.first_caller THEN a.token_id END) as first_calls
      FROM alerts a
      JOIN callers c ON a.caller_id = c.id
      WHERE a.raw_payload_json->>'botMessageId' IS NOT NULL
      GROUP BY COALESCE(c.display_name, c.handle)
      ORDER BY alert_count DESC
    `);

    for (const row of callerStats.rows) {
      console.log(`\n${row.caller_name}:`);
      console.log(`   Total Alerts: ${row.alert_count}`);
      console.log(`   Unique Tokens: ${row.unique_tokens}`);
      console.log(`   First Calls: ${row.first_calls}`);
    }

    console.log('\n');
  } catch (error) {
    console.error('Error querying stats:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

queryStats();
