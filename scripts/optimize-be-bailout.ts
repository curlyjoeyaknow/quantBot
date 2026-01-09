#!/usr/bin/env tsx
/**
 * Break-Even Bailout Optimization Script
 *
 * Optimizes exit plans with:
 * - Fixed TP/SL bands: Multiple TP/SL combinations to test (fixed per run)
 * - Exploring time-based rules (max_hold_ms)
 * - Exploring partial-exit rules (ladder levels)
 * - Exploring be_armed_dd_pct ∈ {10%, 15%, 20%, 25%, 30%}
 *
 * Objective: Maximize final capital over the run
 *
 * Usage:
 *   pnpm exec tsx scripts/optimize-be-bailout.ts
 *
 * To customize TP/SL bands, edit the TP_MULTIPLES and SL_BPS_VALUES arrays below.
 */

import type { ExitPlan } from '../packages/backtest/src/exits/exit-plan.js';

// Fixed TP/SL bands (explore these combinations while optimizing other parameters)
// Each TP/SL pair will be tested with all combinations of other parameters
const TP_MULTIPLES = [5.2, 5.45, 5.7]; // TP band to explore
const SL_BPS_VALUES = [2000, 2500, 3000]; // SL band: 20%, 25%, 30% stop

// Parameter space to explore
const BE_ARMED_DD_PCT_VALUES = [0.1, 0.15, 0.2, 0.25, 0.3]; // 10%, 15%, 20%, 25%, 30%

// Time-based rules (max hold in milliseconds)
const MAX_HOLD_MS_VALUES = [
  30 * 60 * 1000, // 30 minutes
  60 * 60 * 1000, // 1 hour
  2 * 60 * 60 * 1000, // 2 hours
  4 * 60 * 60 * 1000, // 4 hours
  48 * 60 * 60 * 1000, // 48 hours (full horizon)
  null, // No time limit
];

// Partial exit (ladder) configurations
// Note: Ladder levels use the TP multiple from the current TP/SL pair
function generateLadderConfigs(
  tpMultiple: number
): Array<Array<{ kind: 'multiple'; multiple: number; fraction: number }>> {
  return [
    // No ladder (full exit at TP)
    [],
    // Single level: 50% at TP, 50% hold for more
    [{ kind: 'multiple', multiple: tpMultiple, fraction: 0.5 }],
    // Two levels: 30% at TP, 70% hold
    [{ kind: 'multiple', multiple: tpMultiple, fraction: 0.3 }],
    // Three levels: 25% at TP, 25% at 6x, 50% hold
    [
      { kind: 'multiple', multiple: tpMultiple, fraction: 0.25 },
      { kind: 'multiple', multiple: 6.0, fraction: 0.25 },
    ],
  ];
}

/**
 * Generate exit plan for a given configuration
 */
function generateExitPlan(config: {
  tpMultiple: number;
  slBps: number;
  beArmedDdPct: number;
  maxHoldMs: number | null;
  ladderLevels: Array<{ kind: 'multiple'; multiple: number; fraction: number }>;
}): ExitPlan {
  const plan: ExitPlan = {
    // Fixed trailing stop with hard SL
    trailing: {
      enabled: true,
      trail_bps: 0, // No trailing, just hard stop
      hard_stop_bps: config.slBps,
      intrabar_policy: 'STOP_FIRST',
    },
    // Break-even bailout
    break_even_bailout: {
      enabled: true,
      be_armed_dd_pct: config.beArmedDdPct,
    },
  };

  // Add ladder if configured
  if (config.ladderLevels.length > 0) {
    plan.ladder = {
      enabled: true,
      levels: config.ladderLevels,
    };
  }

  // Add time-based exit if configured
  if (config.maxHoldMs !== null) {
    plan.max_hold_ms = config.maxHoldMs;
  }

  return plan;
}

/**
 * Generate all parameter combinations
 * For each TP/SL pair, generates all combinations of other parameters
 */
function generateParameterSpace(): Array<{
  tpMultiple: number;
  slBps: number;
  beArmedDdPct: number;
  maxHoldMs: number | null;
  ladderLevels: Array<{ kind: 'multiple'; multiple: number; fraction: number }>;
  configId: string;
}> {
  const configs: Array<{
    tpMultiple: number;
    slBps: number;
    beArmedDdPct: number;
    maxHoldMs: number | null;
    ladderLevels: Array<{ kind: 'multiple'; multiple: number; fraction: number }>;
    configId: string;
  }> = [];

  // For each TP/SL pair (fixed bands)
  for (const tpMultiple of TP_MULTIPLES) {
    for (const slBps of SL_BPS_VALUES) {
      // Generate ladder configs for this TP
      const ladderConfigs = generateLadderConfigs(tpMultiple);

      // For each combination of other parameters (optimized)
      for (const beArmedDdPct of BE_ARMED_DD_PCT_VALUES) {
        for (const maxHoldMs of MAX_HOLD_MS_VALUES) {
          for (const ladderLevels of ladderConfigs) {
            const tpStr = tpMultiple.toFixed(2).replace('.', 'p');
            const slStr = `${(slBps / 100).toFixed(0)}pct`;
            const configId = `tp_${tpStr}x_sl_${slStr}_be_${(beArmedDdPct * 100).toFixed(0)}pct_hold_${
              maxHoldMs === null ? 'none' : `${maxHoldMs / (60 * 1000)}min`
            }_ladder_${ladderLevels.length > 0 ? ladderLevels.map((l) => `${l.multiple}x${l.fraction}`).join('_') : 'none'}`;

            configs.push({
              tpMultiple,
              slBps,
              beArmedDdPct,
              maxHoldMs,
              ladderLevels,
              configId,
            });
          }
        }
      }
    }
  }

  return configs;
}

/**
 * Main function
 */
async function main() {
  const configs = generateParameterSpace();

  const tpSlCombinations = TP_MULTIPLES.length * SL_BPS_VALUES.length;
  const otherParamCombinations = BE_ARMED_DD_PCT_VALUES.length * MAX_HOLD_MS_VALUES.length * 4; // 4 ladder variants
  const totalConfigs = tpSlCombinations * otherParamCombinations;

  console.log(`Generated ${configs.length} parameter combinations`);
  console.log('\nFixed TP/SL bands (explored):');
  console.log(`- TP multiples: ${TP_MULTIPLES.join('x, ')}x`);
  console.log(
    `- SL values: ${SL_BPS_VALUES.map((v) => `${v} bps (${(v / 100).toFixed(1)}%)`).join(', ')}`
  );
  console.log(`- TP/SL combinations: ${tpSlCombinations}`);
  console.log('\nOptimized parameters (explored per TP/SL pair):');
  console.log(`- BE armed DD%: ${BE_ARMED_DD_PCT_VALUES.map((v) => `${v * 100}%`).join(', ')}`);
  console.log(
    `- Max hold: ${MAX_HOLD_MS_VALUES.map((v) => {
      if (v === null) return 'none';
      const hours = v / (60 * 60 * 1000);
      if (hours >= 1) return `${hours}h`;
      return `${v / (60 * 1000)}min`;
    }).join(', ')}`
  );
  console.log(`- Ladder configs: 4 variants per TP`);
  console.log(`- Other param combinations per TP/SL: ${otherParamCombinations}`);
  console.log(`\nTotal configurations: ${totalConfigs}`);

  // Generate sample exit plan for first config
  const sampleConfig = configs[0]!;
  const samplePlan = generateExitPlan(sampleConfig);
  console.log('\nSample exit plan (first config):');
  console.log(JSON.stringify(samplePlan, null, 2));

  // Export configs as JSON for use in optimization
  const output = {
    fixedBands: {
      tpMultiples: TP_MULTIPLES,
      slBpsValues: SL_BPS_VALUES,
      note: 'Each TP/SL combination is tested with all other parameter combinations',
    },
    configs: configs.map((c) => ({
      configId: c.configId,
      tpMultiple: c.tpMultiple,
      slBps: c.slBps,
      exitPlan: generateExitPlan(c),
    })),
  };

  console.log(`\nWriting ${configs.length} configs to optimize-be-bailout-configs.json`);
  const fs = await import('fs/promises');
  await fs.writeFile('optimize-be-bailout-configs.json', JSON.stringify(output, null, 2));

  console.log('\nTo run optimization:');
  console.log('1. Use the generated configs with your backtest runner');
  console.log('2. Each config should be tested against your call dataset');
  console.log('3. Rank by final capital (total R)');
  console.log('4. Analyze which TP/SL bands perform best');
  console.log(
    '5. Analyze which other parameters (BE DD%, max hold, ladder) work best per TP/SL band'
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { generateExitPlan, generateParameterSpace, TP_MULTIPLES, SL_BPS_VALUES };
