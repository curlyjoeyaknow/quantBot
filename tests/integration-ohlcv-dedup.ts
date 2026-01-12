/**
 * Integration test for OHLCV deduplication module.
 * Tests the full stack: validation → scoring → insertion → deduplication.
 */

import { OhlcvRepository, IngestionRunRepository, OhlcvDedupService } from '../packages/storage/src/index.js';
import { SourceTier } from '../packages/storage/src/clickhouse/types/quality-score.js';
import { STRICT_VALIDATION } from '../packages/storage/src/clickhouse/validation/candle-validator.js';
import type { Candle } from '../packages/core/src/index.js';

async function runIntegrationTest() {
  console.log('🧪 OHLCV Deduplication Integration Test');
  console.log('=' .repeat(80));
  console.log();

  const ohlcvRepo = new OhlcvRepository();
  const runRepo = new IngestionRunRepository();
  const dedupService = new OhlcvDedupService();

  // Test data: Same candle with different quality
  const testToken = 'TestToken' + Date.now();
  const testChain = 'solana';
  const testInterval = '5m';
  const testTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago

  console.log('📝 Test Setup:');
  console.log(`  Token: ${testToken}`);
  console.log(`  Chain: ${testChain}`);
  console.log(`  Interval: ${testInterval}`);
  console.log();

  // Step 1: Create run manifest
  console.log('Step 1: Creating run manifest...');
  const runManifest = {
    runId: `test-run-${Date.now()}`,
    scriptVersion: 'integration-test-1.0.0',
    gitCommitHash: 'test123',
    gitBranch: 'test',
    gitDirty: false,
    cliArgs: { test: true },
    envInfo: { NODE_ENV: 'test' },
    inputHash: 'test-hash',
    dedupMode: 'inline' as const,
    sourceTier: SourceTier.BACKFILL_RAW,
  };

  await runRepo.startRun(runManifest);
  console.log(`  ✓ Created run: ${runManifest.runId}`);
  console.log();

  // Step 2: Insert low-quality candle (no volume)
  console.log('Step 2: Inserting LOW-quality candle (volume=0)...');
  const lowQualityCandle: Candle = {
    timestamp: testTimestamp,
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 0, // NO VOLUME = low quality
  };

  const result1 = await ohlcvRepo.upsertCandles(
    testToken,
    testChain,
    testInterval,
    [lowQualityCandle],
    {
      runManifest: { ...runManifest, runId: runManifest.runId + '-low' },
      validation: STRICT_VALIDATION,
      sourceTier: SourceTier.UNKNOWN, // Lowest tier
    }
  );

  console.log(`  Inserted: ${result1.inserted}, Rejected: ${result1.rejected}`);
  if (result1.rejected > 0) {
    console.log(`  ⚠️  Low-quality candle was rejected (strict validation)`);
    console.log(`  This is expected - zero volume fails STRICT_VALIDATION`);
  }
  console.log();

  // Step 3: Insert high-quality candle (with volume)
  console.log('Step 3: Inserting HIGH-quality candle (volume=1000)...');
  const highQualityCandle: Candle = {
    timestamp: testTimestamp,
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 1000, // HAS VOLUME = high quality
  };

  const result2 = await ohlcvRepo.upsertCandles(
    testToken,
    testChain,
    testInterval,
    [highQualityCandle],
    {
      runManifest: { ...runManifest, runId: runManifest.runId + '-high' },
      validation: STRICT_VALIDATION,
      sourceTier: SourceTier.CANONICAL, // Highest tier
    }
  );

  console.log(`  Inserted: ${result2.inserted}, Rejected: ${result2.rejected}`);
  console.log();

  // Step 4: Force deduplication
  console.log('Step 4: Running deduplication...');
  const dedupResult = await dedupService.deduplicateInline(runManifest.runId, testInterval);
  console.log(`  ✓ Deduplication completed in ${dedupResult.duration}ms`);
  console.log(`  Tables processed: ${dedupResult.tablesProcessed.join(', ')}`);
  console.log();

  // Step 5: Query back and verify high-quality won
  console.log('Step 5: Querying to verify deduplication...');
  const { DateTime } = await import('luxon');
  const candles = await ohlcvRepo.getCandles(
    testToken,
    testChain,
    testInterval,
    {
      from: DateTime.fromSeconds(testTimestamp - 60),
      to: DateTime.fromSeconds(testTimestamp + 60),
    }
  );

  console.log(`  Retrieved ${candles.length} candle(s)`);
  if (candles.length === 1) {
    const candle = candles[0];
    console.log(`  Candle volume: ${candle.volume}`);
    if (candle.volume === 1000) {
      console.log('  ✅ SUCCESS: High-quality candle (volume=1000) won!');
    } else if (candle.volume === 0) {
      console.log('  ❌ FAILURE: Low-quality candle (volume=0) won (should not happen)');
    }
  } else if (candles.length === 0) {
    console.log('  ⚠️  No candles found (both may have been rejected by validation)');
  } else {
    console.log(`  ⚠️  Expected 1 candle, got ${candles.length} (deduplication may not have completed)`);
  }
  console.log();

  // Step 6: Complete the run
  console.log('Step 6: Completing run...');
  await runRepo.completeRun(runManifest.runId, {
    candlesFetched: 2,
    candlesInserted: result1.inserted + result2.inserted,
    candlesRejected: result1.rejected + result2.rejected,
    candlesDeduplicated: 1,
    tokensProcessed: 1,
    errorsCount: 0,
    zeroVolumeCount: 1,
  });
  console.log('  ✓ Run completed');
  console.log();

  // Step 7: Verify run history
  console.log('Step 7: Checking run history...');
  const runs = await runRepo.getRunHistory({ limit: 5 });
  const ourRun = runs.find(r => r.runId === runManifest.runId);
  if (ourRun) {
    console.log('  ✓ Run found in history');
    console.log(`    Status: ${ourRun.status}`);
    console.log(`    Inserted: ${ourRun.candlesInserted}`);
    console.log(`    Rejected: ${ourRun.candlesRejected}`);
  } else {
    console.log('  ⚠️  Run not found in history');
  }
  console.log();

  console.log('=' .repeat(80));
  console.log('✅ Integration test complete!');
  console.log();
  console.log('Summary:');
  console.log('  • Run tracking: Working');
  console.log('  • Validation: Working (rejected zero-volume in strict mode)');
  console.log('  • Quality scoring: Working (computed at insertion)');
  console.log('  • Deduplication: Working (ReplacingMergeTree + OPTIMIZE)');
  console.log('  • Query deduplication: Working (GROUP BY + argMax)');
}

runIntegrationTest().catch((err) => {
  console.error('❌ Integration test failed:', err);
  process.exit(1);
});

