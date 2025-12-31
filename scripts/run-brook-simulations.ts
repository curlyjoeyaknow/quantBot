#!/usr/bin/env tsx
/**
 * Run simulations for Brook calls since July 2024
 * Bypasses CLI run ID validation for batch operations
 */

import { runSimulationDuckdb } from '@quantbot/workflows';
import { createDuckdbSimulationContext } from '@quantbot/workflows';
import { SimulationService } from '@quantbot/simulation';
import { DuckDBStorageService } from '@quantbot/simulation';
import { OhlcvIngestionService } from '@quantbot/ingestion';

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

async function main() {
  const duckdbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';
  console.log(`\n🚀 Running simulations for Brook calls since July 2024`);
  console.log(`📊 Using DuckDB: ${duckdbPath}\n`);

  // Create context
  const simulationService = new SimulationService();
  const duckdbStorageService = new DuckDBStorageService();
  const ohlcvIngestionService = new OhlcvIngestionService();

  const ctx = await createDuckdbSimulationContext({
    simulationService,
    duckdbStorageService,
    ohlcvIngestionService,
  });

  // Run simulations for each strategy
  for (const strategy of STRATEGIES) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📈 Running ${strategy.name}...`);
    console.log(`${'='.repeat(80)}\n`);

    try {
      const result = await runSimulationDuckdb(
        {
          duckdbPath,
          strategy: strategy.config,
          batch: true,
          initialCapital: 1000.0,
          lookbackMinutes: 260,
          lookforwardMinutes: 1440,
          resume: true,
          errorMode: 'collect',
          callsLimit: 1000,
        },
        ctx
      );

      if (result.success) {
        const summary = result.simulationResults?.summary;
        console.log(`✅ ${strategy.name} completed:`);
        console.log(`   Total runs: ${summary?.total_runs ?? 0}`);
        console.log(`   Successful: ${summary?.successful ?? 0}`);
        console.log(`   Failed: ${summary?.failed ?? 0}`);
        console.log(`   Calls simulated: ${result.callsSimulated}`);
        console.log(`   Calls succeeded: ${result.callsSucceeded}`);
        console.log(`   Calls failed: ${result.callsFailed}`);
        console.log(`   Calls skipped: ${result.callsSkipped}`);
      } else {
        console.log(`❌ ${strategy.name} failed`);
        console.log(`   Error: ${result.error ?? 'Unknown error'}`);
      }
    } catch (error: any) {
      console.error(`❌ Error running ${strategy.name}:`, error.message);
      if (error.stack) {
        console.error(error.stack);
      }
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
