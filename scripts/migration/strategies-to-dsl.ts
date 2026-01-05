#!/usr/bin/env tsx
/**
 * Migrate Strategies to DSL Format
 *
 * Converts existing strategy presets to DSL format and creates additional variations.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getPreset, listPresets } from '@quantbot/backtest';
import type {
  StrategyConfig,
  StrategyLeg,
  StopLossConfig,
  EntryConfig,
  ReEntryConfig,
  SignalGroup,
  LadderConfig,
} from '@quantbot/backtest';
import type { StrategyDSL } from '@quantbot/core';
import { validateFull } from '@quantbot/core';

const OUTPUT_DIR = join(process.cwd(), 'strategies/dsl');

/**
 * Create output directory if it doesn't exist
 */
function ensureOutputDir(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Convert legacy StrategyConfig to StrategyDSL
 */
function convertStrategyConfigToDSL(config: StrategyConfig): StrategyDSL {
  // Convert entry condition
  const entry = convertEntryConfig(config.entry, config.entrySignal);

  // Convert exit conditions
  const exit = convertExitConditions(
    config.profitTargets,
    config.stopLoss,
    config.exitSignal,
    config.holdHours,
    config.exitLadder
  );

  // Convert re-entry condition
  const reEntry = convertReEntryConfig(config.reEntry);

  // Convert risk constraints
  const risk = convertRiskConstraints(config.lossClampPercent, config.minExitPrice);

  // Build DSL
  const dsl: StrategyDSL = {
    version: '1.0.0',
    name: config.name,
    description: (config.metadata?.description as string | undefined) || (config as any).notes,
    tags: (config.metadata?.tags as string[] | undefined) || config.tags || [],
    entry,
    exit,
  };

  if (reEntry) {
    dsl.reEntry = reEntry;
  }

  if (risk && (risk.maxLossPercent || risk.minExitPrice)) {
    dsl.risk = risk;
  }

  // Convert costs if present in metadata
  if (config.metadata?.costs) {
    dsl.costs = config.metadata.costs as StrategyDSL['costs'];
  }

  if (config.metadata) {
    dsl.metadata = config.metadata;
  }

  return dsl;
}

/**
 * Convert entry config to DSL entry condition
 */
function convertEntryConfig(
  entryConfig: EntryConfig | undefined,
  entrySignal: SignalGroup | undefined
): StrategyDSL['entry'] {
  // If signal-based entry, use signal type
  if (entrySignal) {
    return {
      type: 'signal',
      signal: entrySignal,
      maxWaitMinutes: entryConfig?.maxWaitTime || 1440,
    };
  }

  // If no entry config, use immediate
  if (!entryConfig) {
    return {
      type: 'immediate',
    };
  }

  // Check for price drop entry
  if (entryConfig.initialEntry !== undefined && entryConfig.initialEntry !== 'none') {
    return {
      type: 'price_drop',
      priceDropPercent: entryConfig.initialEntry as number,
      maxWaitMinutes: entryConfig.maxWaitTime,
    };
  }

  // Check for trailing rebound entry
  if (entryConfig.trailingEntry !== undefined && entryConfig.trailingEntry !== 'none') {
    return {
      type: 'trailing_rebound',
      reboundPercent: entryConfig.trailingEntry as number,
      maxWaitMinutes: entryConfig.maxWaitTime,
    };
  }

  // Default to immediate
  return {
    type: 'immediate',
  };
}

/**
 * Convert profit targets and stop loss to exit conditions
 */
function convertExitConditions(
  profitTargets: StrategyLeg[] | undefined,
  stopLoss: StopLossConfig | undefined,
  exitSignal: SignalGroup | undefined,
  holdHours: number | undefined,
  exitLadder: LadderConfig | undefined
): StrategyDSL['exit'] {
  const exits: StrategyDSL['exit'] = [];

  // Add profit targets
  if (profitTargets && profitTargets.length > 0) {
    for (const target of profitTargets) {
      exits.push({
        type: 'profit_target',
        profitTarget: target.target,
        percentToExit: target.percent,
      });
    }
  }

  // Add stop loss
  if (stopLoss) {
    exits.push({
      type: 'stop_loss',
      stopLossPercent: stopLoss.initial,
      trailingStopThreshold: stopLoss.trailing === 'none' ? undefined : stopLoss.trailing,
      trailingStopPercent: stopLoss.trailingPercent,
    });
  }

  // Add time-based exit if holdHours is specified
  if (holdHours !== undefined) {
    // Check if we already have a time exit (shouldn't happen, but be safe)
    const hasTimeExit = exits.some((e) => e.type === 'time');
    if (!hasTimeExit) {
      exits.push({
        type: 'time',
        holdHours,
      });
    }
  }

  // Add signal-based exit
  if (exitSignal) {
    exits.push({
      type: 'signal',
      signal: exitSignal,
    });
  }

  // Add ladder exit
  if (exitLadder) {
    exits.push({
      type: 'ladder',
      ladder: {
        legs: exitLadder.legs.map((leg) => ({
          id: leg.id,
          sizePercent: leg.sizePercent,
          priceOffset: leg.priceOffset,
          multiple: leg.multiple,
          signal: leg.signal,
        })),
        sequential: exitLadder.sequential,
      },
    });
  }

  // Ensure at least one exit (default to 2x target if none)
  if (exits.length === 0) {
    exits.push({
      type: 'profit_target',
      profitTarget: 2.0,
      percentToExit: 1.0,
    });
  }

  return exits;
}

/**
 * Convert re-entry config to DSL re-entry condition
 */
function convertReEntryConfig(
  reEntryConfig: ReEntryConfig | undefined
): StrategyDSL['reEntry'] | undefined {
  if (!reEntryConfig) {
    return undefined;
  }

  if (reEntryConfig.trailingReEntry === 'none' || reEntryConfig.maxReEntries === 0) {
    return {
      enabled: false,
    };
  }

  return {
    enabled: true,
    type: 'trailing_retrace',
    retracePercent:
      typeof reEntryConfig.trailingReEntry === 'number' ? reEntryConfig.trailingReEntry : undefined,
    maxReEntries: reEntryConfig.maxReEntries,
    sizePercent: reEntryConfig.sizePercent,
  };
}

/**
 * Convert risk constraints
 */
function convertRiskConstraints(
  lossClampPercent: number | undefined,
  minExitPrice: number | undefined
): StrategyDSL['risk'] | undefined {
  if (!lossClampPercent && !minExitPrice) {
    return undefined;
  }

  return {
    maxLossPercent: lossClampPercent,
    minExitPrice,
  };
}

/**
 * Convert and save a strategy preset to DSL format
 */
function convertAndSavePreset(presetName: string): void {
  const preset = getPreset(presetName);
  if (!preset) {
    console.error(`Preset not found: ${presetName}`);
    return;
  }

  console.log(`Converting ${presetName}...`);

  // Convert to DSL
  const dsl = convertStrategyConfigToDSL(preset);

  // Validate
  const validation = validateFull(dsl);
  if (!validation.schemaValid) {
    console.error(`Schema validation failed for ${presetName}:`, validation.schemaErrors);
    return;
  }

  if (!validation.consistencyValid) {
    console.warn(`Consistency warnings for ${presetName}:`, validation.consistencyErrors);
  }

  if (validation.warnings.length > 0) {
    console.warn(`Warnings for ${presetName}:`, validation.warnings);
  }

  // Save to file
  const filename = `${presetName}.json`;
  const filepath = join(OUTPUT_DIR, filename);
  writeFileSync(filepath, JSON.stringify(dsl, null, 2), 'utf-8');
  console.log(`  Saved to ${filepath}`);
}

/**
 * Create additional strategy variations
 */
function createAdditionalStrategies(): void {
  console.log('\nCreating additional strategy variations...');

  // 1. Momentum Breakout
  const momentumBreakout: StrategyConfig = {
    name: 'Momentum_Breakout',
    profitTargets: [
      { target: 2.5, percent: 0.4 },
      { target: 5.0, percent: 0.6 },
    ],
    stopLoss: {
      initial: -0.25,
      trailing: 1.5,
      trailingPercent: 0.2,
    },
    entry: {
      initialEntry: 'none',
      trailingEntry: 'none',
      maxWaitTime: 60,
    },
    metadata: {
      description: 'Momentum breakout strategy with trailing stop',
      tags: ['momentum', 'breakout'],
    },
  };

  // 2. Mean Reversion
  const meanReversion: StrategyConfig = {
    name: 'Mean_Reversion',
    profitTargets: [
      { target: 1.5, percent: 0.6 },
      { target: 2.0, percent: 0.4 },
    ],
    stopLoss: {
      initial: -0.15,
      trailing: 'none',
    },
    entry: {
      initialEntry: -0.2, // Wait for 20% drop
      trailingEntry: 0.05, // Wait for 5% rebound
      maxWaitTime: 120,
    },
    metadata: {
      description: 'Mean reversion strategy - buy dips, sell rallies',
      tags: ['mean-reversion', 'dip-buying'],
    },
  };

  // 3. Scalper Fast
  const scalperFast: StrategyConfig = {
    name: 'Scalper_Fast',
    profitTargets: [
      { target: 1.2, percent: 0.5 },
      { target: 1.5, percent: 0.5 },
    ],
    stopLoss: {
      initial: -0.1,
      trailing: 'none',
    },
    holdHours: 1,
    metadata: {
      description: 'Fast scalping strategy with tight stops',
      tags: ['scalping', 'fast'],
    },
  };

  // 4. Swing Trader
  const swingTrader: StrategyConfig = {
    name: 'Swing_Trader',
    profitTargets: [
      { target: 3.0, percent: 0.3 },
      { target: 5.0, percent: 0.4 },
      { target: 10.0, percent: 0.3 },
    ],
    stopLoss: {
      initial: -0.3,
      trailing: 2.0,
      trailingPercent: 0.25,
    },
    holdHours: 72, // 3 days
    reEntry: {
      trailingReEntry: 0.4,
      maxReEntries: 2,
      sizePercent: 0.5,
    },
    metadata: {
      description: 'Swing trading strategy with multi-day holds',
      tags: ['swing', 'multi-day'],
    },
  };

  // 5. Conservative Long Hold
  const conservativeLong: StrategyConfig = {
    name: 'Conservative_LongHold',
    profitTargets: [
      { target: 2.0, percent: 0.25 },
      { target: 3.0, percent: 0.25 },
      { target: 5.0, percent: 0.25 },
      { target: 10.0, percent: 0.25 },
    ],
    stopLoss: {
      initial: -0.2,
      trailing: 1.5,
      trailingPercent: 0.15,
    },
    holdHours: 168, // 7 days
    lossClampPercent: -0.15,
    metadata: {
      description: 'Conservative strategy with long holds and tight risk',
      tags: ['conservative', 'long-hold'],
    },
  };

  // 6. Aggressive Multi-Entry
  const aggressiveMultiEntry: StrategyConfig = {
    name: 'Aggressive_MultiEntry',
    profitTargets: [
      { target: 5.0, percent: 0.3 },
      { target: 10.0, percent: 0.7 },
    ],
    stopLoss: {
      initial: -0.4,
      trailing: 'none',
    },
    entry: {
      initialEntry: -0.3,
      trailingEntry: 0.1,
      maxWaitTime: 180,
    },
    reEntry: {
      trailingReEntry: 0.5,
      maxReEntries: 3,
      sizePercent: 0.6,
    },
    metadata: {
      description: 'Aggressive strategy with multiple entries',
      tags: ['aggressive', 'multi-entry'],
    },
  };

  // Convert and save all additional strategies
  const additionalStrategies = [
    momentumBreakout,
    meanReversion,
    scalperFast,
    swingTrader,
    conservativeLong,
    aggressiveMultiEntry,
  ];

  for (const strategy of additionalStrategies) {
    const dsl = convertStrategyConfigToDSL(strategy);
    const validation = validateFull(dsl);

    if (!validation.schemaValid) {
      console.error(`Schema validation failed for ${strategy.name}:`, validation.schemaErrors);
      continue;
    }

    const filename = `${strategy.name.toLowerCase().replace(/_/g, '-')}.json`;
    const filepath = join(OUTPUT_DIR, filename);
    writeFileSync(filepath, JSON.stringify(dsl, null, 2), 'utf-8');
    console.log(`  Created ${filename}`);
  }
}

/**
 * Main migration function
 */
function main(): void {
  console.log('Migrating strategies to DSL format...\n');

  ensureOutputDir();

  // Convert existing presets
  const presets = listPresets();
  console.log(`Found ${presets.length} existing presets\n`);

  for (const presetName of presets) {
    convertAndSavePreset(presetName);
  }

  // Create additional strategies
  createAdditionalStrategies();

  console.log(`\n✅ Migration complete! Strategies saved to ${OUTPUT_DIR}`);
}

if (require.main === module) {
  main();
}
