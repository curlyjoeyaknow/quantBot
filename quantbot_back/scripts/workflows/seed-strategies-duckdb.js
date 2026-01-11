#!/usr/bin/env node
/**
 * Seed Strategy Presets to DuckDB
 * ================================
 * Migrates strategy presets from the simulation package to DuckDB
 */

import { StrategiesRepository } from '@quantbot/storage';
import { getPreset } from '@quantbot/backtest';

const STRATEGY_PRESETS = [
  'basic-6h-20pct-sl',
  'conservative-24h',
  'aggressive-multi-tp',
  'trailing-stop-20pct',
  'buy-the-dip-30pct',
];

/**
 * Convert StrategyConfig from simulation package to database format
 */
function convertStrategyConfig(preset, presetName) {
  // Determine category from preset name
  let category = 'general';
  if (presetName.includes('conservative')) {
    category = 'conservative';
  } else if (presetName.includes('aggressive')) {
    category = 'aggressive';
  } else if (presetName.includes('scalping') || presetName.includes('fast')) {
    category = 'scalping';
  } else if (presetName.includes('dip')) {
    category = 'dip-buying';
  }

  // Build config JSON
  const configJson = {
    name: preset.name,
    profitTargets: preset.profitTargets || [],
  };

  if (preset.stopLoss) {
    configJson.stopLoss = {
      initial: preset.stopLoss.initial,
      trailing: preset.stopLoss.trailing,
      trailingPercent: preset.stopLoss.trailingPercent,
    };
  }

  if (preset.entry) {
    configJson.entry = {
      initialEntry: preset.entry.initialEntry || 'none',
      trailingEntry: preset.entry.trailingEntry || 'none',
      maxWaitTime: preset.entry.maxWaitTime,
    };
  }

  if (preset.reEntry) {
    configJson.reentry = {
      trailingReEntry: preset.reEntry.trailingReEntry,
      maxReEntries: preset.reEntry.maxReEntries,
      sizePercent: preset.reEntry.sizePercent,
    };
  }

  if (preset.holdHours !== undefined) {
    configJson.holdHours = preset.holdHours;
  }

  if (preset.lossClampPercent !== undefined) {
    configJson.lossClampPercent = preset.lossClampPercent;
  }

  // Generate description
  const parts = [];
  if (preset.profitTargets && preset.profitTargets.length > 0) {
    const targets = preset.profitTargets.map((pt) => `${pt.target}x`).join(', ');
    parts.push(`Profit targets: ${targets}`);
  }
  if (preset.stopLoss) {
    parts.push(`Stop loss: ${Math.abs(preset.stopLoss.initial * 100)}%`);
    if (preset.stopLoss.trailing && preset.stopLoss.trailing !== 'none') {
      parts.push(`Trailing stop: ${preset.stopLoss.trailingPercent ? preset.stopLoss.trailingPercent * 100 : 20}%`);
    }
  }
  if (preset.holdHours) {
    parts.push(`Hold duration: ${preset.holdHours}h`);
  }
  if (preset.entry?.initialEntry && preset.entry.initialEntry !== 'none') {
    parts.push(`Entry: ${Math.abs(preset.entry.initialEntry * 100)}% dip`);
  }

  const description = parts.length > 0 ? parts.join(' | ') : `${preset.name} strategy`;

  return {
    name: preset.name,
    version: '1',
    category,
    description,
    config: configJson,
    isActive: true,
  };
}

async function main() {
  console.log('🌱 Seeding strategy presets to DuckDB...\n');

  const dbPath = process.env.DUCKDB_PATH || 'data/quantbot.db';
  const strategiesRepo = new StrategiesRepository(dbPath);

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const presetName of STRATEGY_PRESETS) {
    try {
      const preset = getPreset(presetName);
      
      if (!preset) {
        console.log(`⚠️  Preset '${presetName}' not found, skipping`);
        skipped++;
        continue;
      }

      // Check if strategy already exists
      const existing = await strategiesRepo.findByName(preset.name, '1');

      if (existing) {
        console.log(`⏭️  Skipping ${preset.name} (already exists)`);
        skipped++;
        continue;
      }

      // Convert and create strategy
      const strategyData = convertStrategyConfig(preset, presetName);
      const id = await strategiesRepo.create(strategyData);
      
      console.log(`✅ Created ${preset.name} (ID: ${id})`);
      console.log(`   Category: ${strategyData.category}`);
      console.log(`   Description: ${strategyData.description}`);
      created++;
    } catch (error) {
      console.error(`❌ Error creating ${presetName}:`, error.message);
      errors++;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Created: ${created}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Errors: ${errors}`);
  console.log(`   Total: ${STRATEGY_PRESETS.length}`);

  if (created > 0) {
    console.log(`\n🎯 Strategies are now available in DuckDB`);
  }

  if (errors > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

