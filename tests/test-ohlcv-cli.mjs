/**
 * Test OHLCV CLI handlers directly (bypassing CLI compilation issues)
 */

import { IngestionRunRepository, OhlcvDedupService } from '../packages/storage/dist/index.js';

async function testCliHandlers() {
  console.log('🧪 Testing OHLCV CLI Handlers');
  console.log('='.repeat(80));
  console.log();

  try {
    // Test 1: IngestionRunRepository - List Runs
    console.log('Test 1: List ingestion runs...');
    const runRepo = new IngestionRunRepository();
    const runs = await runRepo.getRunHistory({ limit: 5 });
    console.log(`  ✓ Found ${runs.length} runs`);
    if (runs.length > 0) {
      console.log(`  Latest run: ${runs[0].runId} (status: ${runs[0].status})`);
    }
    console.log();

    // Test 2: OhlcvDedupService - Identify Faulty Runs
    console.log('Test 2: Identify faulty runs...');
    const dedupService = new OhlcvDedupService();
    const faultyRuns = await dedupService.identifyFaultyRuns({
      minErrorRate: 0.5,
      minZeroVolumeRate: 0.8,
    });
    console.log(`  ✓ Found ${faultyRuns.length} potentially faulty runs`);
    console.log();

    // Test 3: Get Run Details
    if (runs.length > 0) {
      console.log('Test 3: Get run details...');
      const runDetails = await runRepo.getRunDetails(runs[0].runId);
      console.log(`  ✓ Run ID: ${runDetails.runId}`);
      console.log(`  ✓ Script Version: ${runDetails.scriptVersion}`);
      console.log(`  ✓ Git Commit: ${runDetails.gitCommitHash}`);
      console.log(`  ✓ Candles Inserted: ${runDetails.candlesInserted}`);
      console.log(`  ✓ Candles Rejected: ${runDetails.candlesRejected}`);
      console.log();
    }

    // Test 4: Dry-run deduplication sweep
    console.log('Test 4: Dry-run deduplication sweep...');
    const dedupResult = await dedupService.deduplicateSweep({
      intervals: ['5m'],
      dryRun: true,
    });
    console.log(`  ✓ Dry run completed in ${dedupResult.duration}ms`);
    console.log(`  ✓ Would process: ${dedupResult.tablesProcessed.join(', ')}`);
    console.log();

    console.log('='.repeat(80));
    console.log('✅ All CLI handler tests PASSED!');
    console.log();
    console.log('Summary:');
    console.log('  ✓ IngestionRunRepository working');
    console.log('  ✓ OhlcvDedupService working');
    console.log('  ✓ Run history retrieval working');
    console.log('  ✓ Faulty run identification working');
    console.log('  ✓ Deduplication sweep working');
    console.log();

  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  }
}

testCliHandlers().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

