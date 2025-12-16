#!/usr/bin/env tsx
/**
 * Seed Example Strategies
 * =======================
 * Adds example strategies to the database for testing the interactive CLI
 */

import { StrategiesRepository } from '@quantbot/storage';
import { initClickHouse, closeClickHouse, closePostgresPool } from '@quantbot/storage';

const EXAMPLE_STRATEGIES = [
  {
    name: 'IchimokuV1',
    version: '1',
    category: 'indicator-based',
    description: 'Ichimoku cloud strategy with dynamic profit targets',
    config: {
      legs: [
        { target: 2.0, percent: 0.3 },
        { target: 3.0, percent: 0.3 },
        { target: 5.0, percent: 0.4 },
      ],
      stopLoss: {
        initial: -0.25,
        trailing: 0.1,
      },
      entry: {
        type: 'immediate',
      },
      costs: {
        entryFee: 0.01,
        exitFee: 0.01,
        slippage: 0.005,
      },
    },
    isActive: true,
  },
  {
    name: 'PT2_SL25',
    version: '1',
    category: 'simple',
    description: '2x profit target with 25% stop loss',
    config: {
      legs: [{ target: 2.0, percent: 1.0 }],
      stopLoss: {
        initial: -0.25,
      },
      entry: {
        type: 'immediate',
      },
      costs: {
        entryFee: 0.01,
        exitFee: 0.01,
        slippage: 0.005,
      },
    },
    isActive: true,
  },
  {
    name: 'Scalper_Fast',
    version: '1',
    category: 'scalping',
    description: 'Fast scalping strategy with tight stops',
    config: {
      legs: [
        { target: 1.5, percent: 0.5 },
        { target: 2.0, percent: 0.5 },
      ],
      stopLoss: {
        initial: -0.15,
        trailing: 0.05,
      },
      entry: {
        type: 'immediate',
      },
      costs: {
        entryFee: 0.01,
        exitFee: 0.01,
        slippage: 0.01,
      },
    },
    isActive: true,
  },
  {
    name: 'Conservative_24h',
    version: '1',
    category: 'conservative',
    description: 'Conservative strategy with 24h hold time',
    config: {
      legs: [
        { target: 3.0, percent: 0.4 },
        { target: 5.0, percent: 0.6 },
      ],
      stopLoss: {
        initial: -0.3,
      },
      entry: {
        type: 'immediate',
      },
      holdHours: 24,
      costs: {
        entryFee: 0.01,
        exitFee: 0.01,
        slippage: 0.005,
      },
    },
    isActive: true,
  },
  {
    name: 'Aggressive_Multi',
    version: '1',
    category: 'aggressive',
    description: 'Aggressive multi-target strategy',
    config: {
      legs: [
        { target: 2.0, percent: 0.25 },
        { target: 3.0, percent: 0.25 },
        { target: 5.0, percent: 0.25 },
        { target: 10.0, percent: 0.25 },
      ],
      stopLoss: {
        initial: -0.4,
        trailing: 0.15,
      },
      entry: {
        type: 'immediate',
      },
      costs: {
        entryFee: 0.01,
        exitFee: 0.01,
        slippage: 0.005,
      },
    },
    isActive: true,
  },
];

async function main() {
  console.log('🌱 Seeding example strategies...\n');

  try {
    // Initialize database connections
    await initClickHouse();

    const strategiesRepo = new StrategiesRepository();

    let created = 0;
    let skipped = 0;

    for (const strategyData of EXAMPLE_STRATEGIES) {
      // Check if strategy already exists
      const existing = await strategiesRepo.findByName(strategyData.name, strategyData.version);

      if (existing) {
        console.log(`⏭️  Skipping ${strategyData.name} (already exists)`);
        skipped++;
        continue;
      }

      // Create strategy
      const id = await strategiesRepo.create(strategyData);
      console.log(`✅ Created ${strategyData.name} (ID: ${id})`);
      created++;
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Created: ${created}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Total: ${EXAMPLE_STRATEGIES.length}`);

    if (created > 0) {
      console.log(`\n🎯 You can now run: quantbot sim`);
    }
  } catch (error: any) {
    console.error('\n❌ Error seeding strategies:');
    console.error(error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await closeClickHouse();
    await closePostgresPool();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
