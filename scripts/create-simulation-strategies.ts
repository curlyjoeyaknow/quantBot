#!/usr/bin/env tsx
/**
 * Create strategies in simulation_strategies table for tele.duckdb
 */

import { DuckDBStorageService } from '@quantbot/simulation';
import { PythonEngine } from '@quantbot/utils';

const strategies = [
  {
    strategyId: 'IchimokuV1',
    name: 'IchimokuV1',
    entryConfig: { type: 'immediate' },
    exitConfig: {
      profit_targets: [
        { target: 2.0, percent: 0.3 },
        { target: 3.0, percent: 0.3 },
        { target: 5.0, percent: 0.4 },
      ],
      stop_loss: { initial: -0.25, trailing: 0.1 },
    },
    costConfig: { entryFee: 0.01, exitFee: 0.01, slippage: 0.005 },
  },
  {
    strategyId: 'PT2_SL25',
    name: 'PT2_SL25',
    entryConfig: { type: 'immediate' },
    exitConfig: {
      profit_targets: [{ target: 2.0, percent: 1.0 }],
      stop_loss: { initial: -0.25 },
    },
    costConfig: { entryFee: 0.01, exitFee: 0.01, slippage: 0.005 },
  },
  {
    strategyId: 'Scalper_Fast',
    name: 'Scalper_Fast',
    entryConfig: { type: 'immediate' },
    exitConfig: {
      profit_targets: [
        { target: 1.5, percent: 0.5 },
        { target: 2.0, percent: 0.5 },
      ],
      stop_loss: { initial: -0.15, trailing: 0.05 },
    },
    costConfig: { entryFee: 0.01, exitFee: 0.01, slippage: 0.01 },
  },
  {
    strategyId: 'Conservative_24h',
    name: 'Conservative_24h',
    entryConfig: { type: 'immediate' },
    exitConfig: {
      profit_targets: [
        { target: 3.0, percent: 0.4 },
        { target: 5.0, percent: 0.6 },
      ],
      stop_loss: { initial: -0.3 },
    },
    costConfig: { entryFee: 0.01, exitFee: 0.01, slippage: 0.005 },
  },
  {
    strategyId: 'Aggressive_Multi',
    name: 'Aggressive_Multi',
    entryConfig: { type: 'immediate' },
    exitConfig: {
      profit_targets: [
        { target: 2.0, percent: 0.25 },
        { target: 3.0, percent: 0.25 },
        { target: 5.0, percent: 0.25 },
        { target: 10.0, percent: 0.25 },
      ],
      stop_loss: { initial: -0.4, trailing: 0.15 },
    },
    costConfig: { entryFee: 0.01, exitFee: 0.01, slippage: 0.005 },
  },
];

async function main() {
  const duckdbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';
  console.log(`\n🌱 Creating strategies in simulation_strategies table...`);
  console.log(`📊 Using DuckDB: ${duckdbPath}\n`);

  const pythonEngine = new PythonEngine();
  const storageService = new DuckDBStorageService(pythonEngine);

  let created = 0;
  let skipped = 0;

  for (const strategy of strategies) {
    try {
      const result = await storageService.storeStrategy(
        duckdbPath,
        strategy.strategyId,
        strategy.name,
        strategy.entryConfig,
        strategy.exitConfig,
        undefined, // reentryConfig
        strategy.costConfig
      );

      if (result.success) {
        console.log(`✅ Created ${strategy.name} (ID: ${strategy.strategyId})`);
        created++;
      } else {
        console.log(`⏭️  Skipped ${strategy.name}: ${result.error}`);
        skipped++;
      }
    } catch (error: any) {
      if (error.message?.includes('already exists') || error.message?.includes('UNIQUE')) {
        console.log(`⏭️  Skipped ${strategy.name} (already exists)`);
        skipped++;
      } else {
        console.error(`❌ Failed to create ${strategy.name}: ${error.message}`);
      }
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Created: ${created}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Total: ${strategies.length}\n`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
