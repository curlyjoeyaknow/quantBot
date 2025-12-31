#!/usr/bin/env tsx
/**
 * Create strategies directly using Python script
 * Fast, no hanging
 */

import { execSync } from 'child_process';
import { resolve } from 'path';

const dbPath = process.env.DUCKDB_PATH || 'data/quantbot.duckdb';
const scriptPath = resolve(process.cwd(), 'tools/storage/duckdb_strategies.py');

const strategies = [
  {
    name: 'IchimokuV1',
    version: '1',
    category: 'indicator-based',
    description: 'Ichimoku cloud strategy with dynamic profit targets',
    config_json: {
      legs: [
        { target: 2.0, percent: 0.3 },
        { target: 3.0, percent: 0.3 },
        { target: 5.0, percent: 0.4 },
      ],
      stopLoss: { initial: -0.25, trailing: 0.1 },
      entry: { type: 'immediate' },
      costs: { entryFee: 0.01, exitFee: 0.01, slippage: 0.005 },
    },
    is_active: true,
  },
  {
    name: 'PT2_SL25',
    version: '1',
    category: 'simple',
    description: '2x profit target with 25% stop loss',
    config_json: {
      legs: [{ target: 2.0, percent: 1.0 }],
      stopLoss: { initial: -0.25 },
      entry: { type: 'immediate' },
      costs: { entryFee: 0.01, exitFee: 0.01, slippage: 0.005 },
    },
    is_active: true,
  },
  {
    name: 'Scalper_Fast',
    version: '1',
    category: 'scalping',
    description: 'Fast scalping strategy with tight stops',
    config_json: {
      legs: [
        { target: 1.5, percent: 0.5 },
        { target: 2.0, percent: 0.5 },
      ],
      stopLoss: { initial: -0.15, trailing: 0.05 },
      entry: { type: 'immediate' },
      costs: { entryFee: 0.01, exitFee: 0.01, slippage: 0.01 },
    },
    is_active: true,
  },
  {
    name: 'Conservative_24h',
    version: '1',
    category: 'conservative',
    description: 'Conservative strategy with 24h hold time',
    config_json: {
      legs: [
        { target: 3.0, percent: 0.4 },
        { target: 5.0, percent: 0.6 },
      ],
      stopLoss: { initial: -0.3 },
      entry: { type: 'immediate' },
      holdHours: 24,
      costs: { entryFee: 0.01, exitFee: 0.01, slippage: 0.005 },
    },
    is_active: true,
  },
  {
    name: 'Aggressive_Multi',
    version: '1',
    category: 'aggressive',
    description: 'Aggressive multi-target strategy',
    config_json: {
      legs: [
        { target: 2.0, percent: 0.25 },
        { target: 3.0, percent: 0.25 },
        { target: 5.0, percent: 0.25 },
        { target: 10.0, percent: 0.25 },
      ],
      stopLoss: { initial: -0.4, trailing: 0.15 },
      entry: { type: 'immediate' },
      costs: { entryFee: 0.01, exitFee: 0.01, slippage: 0.005 },
    },
    is_active: true,
  },
];

console.log('🌱 Creating strategies...\n');

// Initialize database
try {
  execSync(`python3 "${scriptPath}" --operation init --db-path "${dbPath}"`, {
    stdio: 'inherit',
    timeout: 5000,
  });
  console.log('✅ Database initialized\n');
} catch (error: any) {
  if (error.status !== 0 && !error.message.includes('already exists')) {
    console.error('⚠️  Database init warning (may already exist)');
  }
}

// Create strategies
let created = 0;
let skipped = 0;

for (const strategy of strategies) {
  try {
    const data = JSON.stringify(strategy);
    const result = execSync(
      `python3 "${scriptPath}" --operation create --db-path "${dbPath}" --data '${data.replace(/'/g, "'\\''")}'`,
      {
        encoding: 'utf-8',
        timeout: 3000,
        stdio: 'pipe',
      }
    );
    const parsed = JSON.parse(result.trim());
    if (parsed.id) {
      console.log(`✅ Created ${strategy.name} (ID: ${parsed.id})`);
      created++;
    } else {
      console.log(`⏭️  Skipped ${strategy.name} (already exists)`);
      skipped++;
    }
  } catch (error: any) {
    if (error.stdout && error.stdout.includes('already exists')) {
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
