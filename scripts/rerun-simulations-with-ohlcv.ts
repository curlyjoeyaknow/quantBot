#!/usr/bin/env tsx
/**
 * Re-run simulations now that OHLCV data is available
 * Processes calls one at a time with progress tracking
 */

import { runSimulationDuckdb } from '@quantbot/workflows';
import { createDuckdbSimulationContext } from '@quantbot/workflows';
import { SimulationService } from '@quantbot/simulation';
import { DuckDBStorageService } from '@quantbot/simulation';
import { OhlcvIngestionService } from '@quantbot/ingestion';
import { PythonEngine } from '@quantbot/utils';

const STRATEGIES = [
  'IchimokuV1',
  'PT2_SL25',
  'Scalper_Fast',
  'Conservative_24h',
  'Aggressive_Multi',
];

async function main() {
  const duckdbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';
  console.log(`\n🚀 Re-running simulations with OHLCV data`);
  console.log(`📊 Using DuckDB: ${duckdbPath}\n`);

  // Create context
  const pythonEngine = new PythonEngine();
  const simulationService = new SimulationService(pythonEngine);
  const duckdbStorageService = new DuckDBStorageService(pythonEngine);
  const ohlcvIngestionService = new OhlcvIngestionService();

  const ctx = await createDuckdbSimulationContext({
    simulationService,
    duckdbStorageService,
    ohlcvIngestionService,
  });

  // Query calls once
  console.log('📞 Querying Brook calls...');
  const callsResult = await duckdbStorageService.queryCalls(
    duckdbPath,
    1000,
    false, // excludeUnrecoverable
    'Brook' // callerName
  );

  if (!callsResult.success || !callsResult.calls || callsResult.calls.length === 0) {
    console.log('❌ No Brook calls found');
    return;
  }

  // Filter calls since July 2024
  const july2024 = new Date('2024-07-01T00:00:00Z').toISOString();
  const filteredCalls = callsResult.calls.filter((call) => call.alert_timestamp >= july2024);

  console.log(`✅ Found ${filteredCalls.length} Brook calls since July 2024\n`);

  // Run simulations for each strategy
  for (const strategyName of STRATEGIES) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📈 Running ${strategyName}...`);
    console.log(`${'='.repeat(80)}\n`);

    let successCount = 0;
    let failCount = 0;
    let skipCount = 0;
    const results: Array<{ mint: string; success: boolean; return?: number; trades?: number }> = [];

    for (let i = 0; i < filteredCalls.length; i++) {
      const call = filteredCalls[i];
      process.stdout.write(`  [${i + 1}/${filteredCalls.length}] ${call.mint.substring(0, 8)}... `);

      try {
        const result = await runSimulationDuckdb(
          {
            duckdbPath,
            strategy: {
              strategy_id: strategyName,
              name: strategyName,
              entry_type: 'immediate',
              profit_targets: [], // Will be loaded from DB
              stop_loss_pct: 0.25,
              maker_fee: 0.01,
              taker_fee: 0.01,
              slippage: 0.005,
            },
            batch: false,
            initialCapital: 1000.0,
            lookbackMinutes: 260,
            lookforwardMinutes: 1440,
            resume: true,
            errorMode: 'collect',
            mint: call.mint,
            alertTimestamp: call.alert_timestamp,
          },
          ctx
        );

        if (result.success && result.simulationResults?.results?.[0]) {
          const simResult = result.simulationResults.results[0];
          const returnPct = simResult.total_return_pct ?? 0;
          const trades = simResult.total_trades ?? 0;

          if (trades > 0) {
            successCount++;
            results.push({ mint: call.mint, success: true, return: returnPct, trades });
            console.log(`✅ ${returnPct.toFixed(2)}% (${trades} trades)`);
          } else {
            skipCount++;
            console.log(`⏭️  No trades`);
          }
        } else {
          failCount++;
          results.push({ mint: call.mint, success: false });
          console.log(`❌ Failed`);
        }
      } catch (error: any) {
        if (error.message?.includes('insufficient data') || error.message?.includes('skipped')) {
          skipCount++;
          console.log(`⏭️  Skipped`);
        } else {
          failCount++;
          console.log(`❌ Error`);
        }
      }
    }

    // Summary
    const profitable = results.filter((r) => r.success && r.return && r.return > 0).length;
    const avgReturn =
      results
        .filter((r) => r.success && r.return !== undefined)
        .reduce((sum, r) => sum + (r.return ?? 0), 0) / successCount || 0;

    console.log(`\n✅ ${strategyName} Summary:`);
    console.log(`   Successful: ${successCount}/${filteredCalls.length}`);
    console.log(`   Profitable: ${profitable}`);
    console.log(`   Failed: ${failCount}`);
    console.log(`   Skipped: ${skipCount}`);
    if (successCount > 0) {
      console.log(`   Avg Return: ${avgReturn.toFixed(2)}%`);
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ All simulations complete!`);
  console.log(`${'='.repeat(80)}\n`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
