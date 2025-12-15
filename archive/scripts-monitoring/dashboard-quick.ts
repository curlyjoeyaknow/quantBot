#!/usr/bin/env npx ts-node --transpile-only
/**
 * Quick Monitoring Dashboard
 * ==========================
 * Standalone script that uses only the metrics module.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/monitoring/dashboard-quick.ts
 *   npx ts-node --transpile-only scripts/monitoring/dashboard-quick.ts --bench
 */

import { config } from 'dotenv';
config();

// Direct import from source to avoid build issues
import {
  metricsEngine,
  printDashboard,
  runQuickBenchmark,
  loadCallsFromCallerDb,
  enrichCallsWithSimResults,
  checkDataCoverage,
} from '../../packages/monitoring/src/metrics';

async function main() {
  const args = process.argv.slice(2);
  const shouldBench = args.includes('--bench');
  const shouldLoad = args.includes('--load');

  console.log('🔍 QuantBot Quick Monitoring Dashboard');
  console.log('─'.repeat(45));

  // Load from Postgres and enrich with OHLCV cache
  if (shouldLoad) {
    console.log('📂 Loading from Postgres...');
    try {
      const calls = await loadCallsFromCallerDb();
      if (calls.length > 0) {
        console.log(`   ✅ Loaded ${calls.length} calls`);
        console.log('📈 Enriching with ATH from OHLCV cache...');
        const enriched = await enrichCallsWithSimResults(calls);
        metricsEngine.recordCalls(enriched);
      } else {
        console.log('   ⚠️  No calls found');
      }
    } catch (e: any) {
      console.log(`   ❌ Failed: ${e.message}`);
    }
  }

  // Check data coverage
  if (shouldLoad) {
    console.log('📦 Checking data coverage...');
    const coverage = await checkDataCoverage();
    console.log(`   Cache files: ${coverage.totalCached} tokens`);
    console.log(`   5m data: ${coverage.has5mData} | 1m data: ${coverage.has1mData}`);
    console.log(
      `   52-period lookback: ✅ ${coverage.has52PeriodLookback} | ❌ ${coverage.missing52PeriodLookback} | 📭 ${coverage.noCache}`
    );
  }

  // Run benchmark if requested
  if (shouldBench) {
    console.log('\n🏁 Running simulation benchmark...');
    const result = await runQuickBenchmark();
    console.log(
      `   ✅ ${result.tokenCount} tokens × ${result.candleCount / result.tokenCount} candles`
    );
    console.log(`   ⏱️  ${result.totalMs}ms total | ${result.tokensPerSec.toFixed(1)} tok/sec`);
    console.log(`   📊 Avg simulation: ${result.avgSimMs}ms per token`);
  }

  // Always print dashboard
  printDashboard();
}

main().catch(console.error);
