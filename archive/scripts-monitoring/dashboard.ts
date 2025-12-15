#!/usr/bin/env npx ts-node
/**
 * Monitoring Dashboard CLI
 * ========================
 * Quick and simple monitoring dashboard for QuantBot.
 *
 * Usage:
 *   npx ts-node scripts/monitoring/dashboard.ts           # Show dashboard
 *   npx ts-node scripts/monitoring/dashboard.ts --load    # Load from DB first
 *   npx ts-node scripts/monitoring/dashboard.ts --bench   # Run benchmark
 *   npx ts-node scripts/monitoring/dashboard.ts --watch   # Watch mode (refresh every 30s)
 */

import { config } from 'dotenv';
config();

import {
  metricsEngine,
  printDashboard,
  loadMetricsFromDatabases,
  runQuickBenchmark,
} from '@quantbot/monitoring';

async function main() {
  const args = process.argv.slice(2);
  const shouldLoad = args.includes('--load');
  const shouldBench = args.includes('--bench');
  const watchMode = args.includes('--watch');

  console.log('🔍 QuantBot Monitoring Dashboard');
  console.log('─'.repeat(40));

  // Load from databases if requested
  if (shouldLoad) {
    console.log('📂 Loading data from databases...');
    await loadMetricsFromDatabases();
  }

  // Run benchmark if requested
  if (shouldBench) {
    console.log('🏁 Running benchmark...');
    await runQuickBenchmark();
  }

  // Print dashboard
  printDashboard();

  // Watch mode - refresh every 30 seconds
  if (watchMode) {
    console.log('\n👀 Watch mode enabled. Press Ctrl+C to exit.');
    setInterval(async () => {
      console.clear();
      if (shouldLoad) {
        await loadMetricsFromDatabases();
      }
      printDashboard();
    }, 30000);
  }
}

main().catch(console.error);
