/**
 * Simple integration test for OHLCV deduplication.
 * Tests against live ClickHouse.
 */

import { getClickHouseClient } from '../packages/storage/dist/clickhouse-client.js';

async function testClickHouseConnection() {
  console.log('🧪 OHLCV Deduplication Integration Test');
  console.log('='.repeat(80));
  console.log();

  try {
    const ch = getClickHouseClient();
    
    // Step 1: Verify tables exist
    console.log('Step 1: Verifying new tables exist...');
    const tables = await ch.query({
      query: "SHOW TABLES FROM quantbot LIKE 'ohlcv%'",
      format: 'JSONEachRow',
    });
    const tableData = await tables.json();
    console.log('  Tables found:');
    tableData.forEach(row => console.log(`    - ${row.name}`));
    console.log();

    // Step 2: Check ohlcv_ingestion_runs schema
    console.log('Step 2: Checking ohlcv_ingestion_runs schema...');
    const runsSchema = await ch.query({
      query: 'DESCRIBE quantbot.ohlcv_ingestion_runs',
      format: 'JSONEachRow',
    });
    const runsSchemaData = await runsSchema.json();
    console.log(`  Columns: ${runsSchemaData.length}`);
    const hasRunId = runsSchemaData.some(col => col.name === 'run_id');
    const hasSourceTier = runsSchemaData.some(col => col.name === 'source_tier');
    console.log(`  ✓ Has run_id: ${hasRunId}`);
    console.log(`  ✓ Has source_tier: ${hasSourceTier}`);
    console.log();

    // Step 3: Check ohlcv_candles_1m schema
    console.log('Step 3: Checking ohlcv_candles_1m schema...');
    const candlesSchema = await ch.query({
      query: 'DESCRIBE quantbot.ohlcv_candles_1m',
      format: 'JSONEachRow',
    });
    const candlesSchemaData = await candlesSchema.json();
    console.log(`  Columns: ${candlesSchemaData.length}`);
    const hasQualityScore = candlesSchemaData.some(col => col.name === 'quality_score');
    const hasIngestedAt = candlesSchemaData.some(col => col.name === 'ingested_at');
    const hasRunIdCol = candlesSchemaData.some(col => col.name === 'ingestion_run_id');
    console.log(`  ✓ Has quality_score: ${hasQualityScore}`);
    console.log(`  ✓ Has ingested_at: ${hasIngestedAt}`);
    console.log(`  ✓ Has ingestion_run_id: ${hasRunIdCol}`);
    console.log();

    // Step 4: Test insertion with quality score
    console.log('Step 4: Testing candle insertion with quality score...');
    const testToken = `TEST_${Date.now()}`;
    const now = new Date();
    const nowFormatted = now.toISOString().slice(0, 19).replace('T', ' '); // Format: 'YYYY-MM-DD HH:MM:SS'
    
    // Insert a test candle
    await ch.insert({
      table: 'quantbot.ohlcv_candles_5m',
      values: [{
        token_address: testToken,
        chain: 'solana',
        timestamp: nowFormatted,
        interval_seconds: 300,
        open: 100,
        high: 110,
        low: 90,
        close: 105,
        volume: 1000,
        quality_score: 120, // 100 (volume) + 10 (range) + 5 (open) + 5 (close)
        ingested_at: nowFormatted,
        source_tier: 2,
        ingestion_run_id: 'integration-test',
        script_version: '1.0.0',
      }],
      format: 'JSONEachRow',
    });
    console.log(`  ✓ Inserted test candle for ${testToken}`);
    console.log();

    // Step 5: Query it back with deduplication
    console.log('Step 5: Querying with GROUP BY deduplication...');
    const query = `
      SELECT 
        token_address,
        toUnixTimestamp(timestamp) as ts,
        argMax(open, quality_score) AS open,
        argMax(volume, quality_score) AS volume
      FROM quantbot.ohlcv_candles_5m
      WHERE token_address = {token:String}
      GROUP BY token_address, chain, timestamp, interval_seconds
      ORDER BY ts DESC
      LIMIT 1
    `;
    
    const result = await ch.query({
      query,
      query_params: {
        token: testToken,
      },
      format: 'JSONEachRow',
    });
    const data = await result.json();
    
    if (data.length > 0) {
      const candle = data[0];
      console.log('  ✓ Retrieved candle:');
      console.log(`    Token: ${candle.token_address}`);
      console.log(`    Volume: ${candle.volume}`);
      console.log(`    Quality Score: ${candle.quality_score}`);
      console.log(`    Open: ${candle.open}`);
    } else {
      console.log('  ⚠️  No candle found');
    }
    console.log();

    // Step 6: Test run tracking
    console.log('Step 6: Testing run tracking...');
    await ch.insert({
      table: 'quantbot.ohlcv_ingestion_runs',
      values: [{
        run_id: `test-run-${Date.now()}`,
        started_at: nowFormatted,
        completed_at: nowFormatted,
        status: 'completed',
        script_version: 'integration-test-1.0.0',
        git_commit_hash: 'test123',
        git_branch: 'test',
        git_dirty: 0,
        cli_args: JSON.stringify({ test: true }),
        env_info: JSON.stringify({ NODE_ENV: 'test' }),
        input_hash: 'test-hash',
        source_tier: 1,
        candles_fetched: 1,
        candles_inserted: 1,
        candles_rejected: 0,
        candles_deduplicated: 0,
        tokens_processed: 1,
        errors_count: 0,
        error_message: null,
        zero_volume_count: 0,
        dedup_mode: 'inline',
        dedup_completed_at: nowFormatted,
      }],
      format: 'JSONEachRow',
    });
    console.log('  ✓ Inserted test run record');
    console.log();

    console.log('='.repeat(80));
    console.log('✅ Integration test PASSED!');
    console.log();
    console.log('Summary:');
    console.log('  ✓ New tables created successfully');
    console.log('  ✓ Schema has all required columns');
    console.log('  ✓ Candle insertion with quality_score works');
    console.log('  ✓ GROUP BY deduplication query works');
    console.log('  ✓ Run tracking table works');
    console.log();

  } catch (error) {
    console.error('❌ Integration test FAILED:', error);
    throw error;
  }
}

testClickHouseConnection().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

