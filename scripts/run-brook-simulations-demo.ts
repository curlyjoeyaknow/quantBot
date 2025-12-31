#!/usr/bin/env tsx
/**
 * Run simulations for Brook calls since July 2024 - DEMO VERSION
 * Processes first 5 calls per strategy to demonstrate functionality
 */

import { runSimulationDuckdb } from '@quantbot/workflows';
import { createDuckdbSimulationContext } from '@quantbot/workflows';
import { SimulationService } from '@quantbot/simulation';
import { DuckDBStorageService } from '@quantbot/simulation';
import { OhlcvIngestionService } from '@quantbot/ingestion';
import { PythonEngine } from '@quantbot/utils';

const STRATEGIES = [
  {
    name: 'IchimokuV1',
    config: {
      strategy_id: 'IchimokuV1',
      name: 'IchimokuV1',
      entry_type: 'immediate',
      profit_targets: [
        { target: 2.0, percent: 0.3 },
        { target: 3.0, percent: 0.3 },
        { target: 5.0, percent: 0.4 },
      ],
      stop_loss_pct: 0.25,
      trailing_stop_pct: 0.1,
      maker_fee: 0.01,
      taker_fee: 0.01,
      slippage: 0.005,
    },
  },
  {
    name: 'PT2_SL25',
    config: {
      strategy_id: 'PT2_SL25',
      name: 'PT2_SL25',
      entry_type: 'immediate',
      profit_targets: [{ target: 2.0, percent: 1.0 }],
      stop_loss_pct: 0.25,
      maker_fee: 0.01,
      taker_fee: 0.01,
      slippage: 0.005,
    },
  },
  {
    name: 'Scalper_Fast',
    config: {
      strategy_id: 'Scalper_Fast',
      name: 'Scalper_Fast',
      entry_type: 'immediate',
      profit_targets: [
        { target: 1.5, percent: 0.5 },
        { target: 2.0, percent: 0.5 },
      ],
      stop_loss_pct: 0.15,
      trailing_stop_pct: 0.05,
      maker_fee: 0.01,
      taker_fee: 0.01,
      slippage: 0.01,
    },
  },
  {
    name: 'Conservative_24h',
    config: {
      strategy_id: 'Conservative_24h',
      name: 'Conservative_24h',
      entry_type: 'immediate',
      profit_targets: [
        { target: 3.0, percent: 0.4 },
        { target: 5.0, percent: 0.6 },
      ],
      stop_loss_pct: 0.3,
      maker_fee: 0.01,
      taker_fee: 0.01,
      slippage: 0.005,
    },
  },
  {
    name: 'Aggressive_Multi',
    config: {
      strategy_id: 'Aggressive_Multi',
      name: 'Aggressive_Multi',
      entry_type: 'immediate',
      profit_targets: [
        { target: 2.0, percent: 0.25 },
        { target: 3.0, percent: 0.25 },
        { target: 5.0, percent: 0.25 },
        { target: 10.0, percent: 0.25 },
      ],
      stop_loss_pct: 0.4,
      trailing_stop_pct: 0.15,
      maker_fee: 0.01,
      taker_fee: 0.01,
      slippage: 0.005,
    },
  },
];

const DEMO_LIMIT = parseInt(process.env.DEMO_LIMIT || '5', 10); // Process first 5 calls per strategy

async function main() {
  const duckdbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';
  console.log(
    `\n🚀 Running simulations for Brook calls since July 2024 (DEMO: first ${DEMO_LIMIT} calls per strategy)`
  );
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
  const demoCalls = filteredCalls.slice(0, DEMO_LIMIT);

  console.log(`✅ Found ${filteredCalls.length} total Brook calls since July 2024`);
  console.log(`📊 Processing first ${demoCalls.length} calls per strategy for demo\n`);

  // Run simulations for each strategy
  for (const strategy of STRATEGIES) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📈 Running ${strategy.name}...`);
    console.log(`${'='.repeat(80)}\n`);

    let successCount = 0;
    let failCount = 0;
    let skipCount = 0;
    const results: Array<{ mint: string; success: boolean; return?: number }> = [];

    for (let i = 0; i < demoCalls.length; i++) {
      const call = demoCalls[i];
      process.stdout.write(`  [${i + 1}/${demoCalls.length}] ${call.mint.substring(0, 8)}... `);

      try {
        const result = await runSimulationDuckdb(
          {
            duckdbPath,
            strategy: strategy.config,
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
          successCount++;
          results.push({ mint: call.mint, success: true, return: returnPct });
          console.log(`✅ ${returnPct.toFixed(2)}%`);
        } else {
          failCount++;
          results.push({ mint: call.mint, success: false });
          console.log(`❌ Failed`);
        }
      } catch (error: any) {
        if (error.message?.includes('insufficient data') || error.message?.includes('skipped')) {
          skipCount++;
          console.log(`⏭️  Skipped (insufficient data)`);
        } else {
          failCount++;
          console.log(`❌ Error: ${error.message?.substring(0, 50)}`);
        }
      }
    }

    // Summary
    const avgReturn =
      results
        .filter((r) => r.success && r.return !== undefined)
        .reduce((sum, r) => sum + (r.return ?? 0), 0) / successCount || 0;

    console.log(`\n✅ ${strategy.name} Summary:`);
    console.log(`   Successful: ${successCount}/${demoCalls.length}`);
    console.log(`   Failed: ${failCount}`);
    console.log(`   Skipped: ${skipCount}`);
    if (successCount > 0) {
      console.log(`   Avg Return: ${avgReturn.toFixed(2)}%`);
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ Demo complete! Processed ${DEMO_LIMIT} calls per strategy`);
  console.log(`💡 To run full simulation (all ${filteredCalls.length} calls), use:`);
  console.log(`   DEMO_LIMIT=${filteredCalls.length} tsx scripts/run-brook-simulations-demo.ts`);
  console.log(`${'='.repeat(80)}\n`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
