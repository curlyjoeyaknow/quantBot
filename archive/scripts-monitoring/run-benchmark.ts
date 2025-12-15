#!/usr/bin/env npx ts-node
/**
 * Run Simulation Benchmark
 * ========================
 * Run the standard 5000-candle benchmark to measure simulation performance.
 *
 * Usage:
 *   npx ts-node scripts/monitoring/run-benchmark.ts
 *   npx ts-node scripts/monitoring/run-benchmark.ts --baseline  # Set as baseline
 */

import { config } from 'dotenv';
config();

import { DateTime } from 'luxon';
import {
  runBenchmark,
  runQuickBenchmark,
  printBenchmarkComparison,
  metricsEngine,
  STANDARD_BENCHMARK,
} from '@quantbot/monitoring';

async function main() {
  const args = process.argv.slice(2);
  const setBaseline = args.includes('--baseline');

  console.log('🏁 QuantBot Simulation Benchmark');
  console.log('─'.repeat(40));

  // Run quick benchmark (no API calls, uses mock data)
  console.log('\n📊 Running quick benchmark (100 tokens × 5000 candles)...');
  const result = await runQuickBenchmark();

  console.log('\n✅ Benchmark Complete');
  console.log(`   Total time: ${result.totalMs}ms`);
  console.log(`   Throughput: ${result.tokensPerSec.toFixed(1)} tokens/sec`);
  console.log(`   Avg simulation: ${result.avgSimMs}ms per token`);

  if (setBaseline) {
    console.log('\n📌 Setting as baseline for drift detection');
    metricsEngine.recordBenchmark({
      ...result,
      isBaseline: true,
      name: 'Baseline: ' + result.name,
    });
  }

  // Check for drift from baseline
  const baseline = metricsEngine.getDashboardSummary().system.lastBenchmark;
  if (baseline && baseline.isBaseline && !setBaseline) {
    console.log('\n📈 Comparing to baseline...');
    printBenchmarkComparison(result, baseline);
  }
}

main().catch(console.error);
