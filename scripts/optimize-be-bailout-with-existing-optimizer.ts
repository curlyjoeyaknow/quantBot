#!/usr/bin/env tsx
/**
 * Break-Even Bailout Optimization using Existing Optimizer
 *
 * This script shows how to use the existing `backtest optimize` command
 * with custom policy generation that matches your BE bailout requirements.
 *
 * Since the existing optimizer uses RiskPolicy (not ExitPlan), we need to:
 * 1. Use FixedStopPolicy with fixed TP=5.45x and SL=25% (0.75x)
 * 2. Use TimeStopPolicy to explore time-based exits
 * 3. Use LadderPolicy to explore partial exits
 * 4. Note: BE bailout isn't directly supported in RiskPolicy, but you can:
 *    - Run the optimizer to find best TP/SL/time/ladder combos
 *    - Then test BE bailout separately using exit-stack mode
 */

import type { RiskPolicy } from '../packages/backtest/src/policies/risk-policy.js';

// Fixed parameters
const FIXED_TP_MULTIPLE = 5.45; // Middle of [5.2, 5.7]
const FIXED_SL_PCT = 0.25; // 25% stop (middle of [0.72, 0.78] = 22-28%)

// Parameter space to explore
const BE_ARMED_DD_PCT_VALUES = [0.1, 0.15, 0.2, 0.25, 0.3]; // 10%, 15%, 20%, 25%, 30%

// Time-based rules (max hold in milliseconds)
const MAX_HOLD_MS_VALUES = [
  30 * 60 * 1000, // 30 minutes
  60 * 60 * 1000, // 1 hour
  2 * 60 * 60 * 1000, // 2 hours
  4 * 60 * 60 * 1000, // 4 hours
];

// Ladder configurations (partial exits)
const LADDER_CONFIGS: Array<Array<{ multiple: number; fraction: number }>> = [
  // No ladder (full exit at TP) - represented as FixedStopPolicy with TP
  [],
  // Single level: 50% at TP, 50% hold
  [{ multiple: FIXED_TP_MULTIPLE, fraction: 0.5 }],
  // Two levels: 30% at TP, 70% hold
  [{ multiple: FIXED_TP_MULTIPLE, fraction: 0.3 }],
  // Three levels: 25% at TP, 25% at 6x, 50% hold
  [
    { multiple: FIXED_TP_MULTIPLE, fraction: 0.25 },
    { multiple: 6.0, fraction: 0.25 },
  ],
];

/**
 * Generate RiskPolicy configurations that match your optimization space
 *
 * Note: BE bailout isn't in RiskPolicy, so this generates policies with:
 * - Fixed TP=5.45x and SL=25%
 * - Time-based exits
 * - Ladder exits
 *
 * You'll need to test BE bailout separately using exit-stack mode.
 */
function generateRiskPolicies(): RiskPolicy[] {
  const policies: RiskPolicy[] = [];

  // 1. Fixed stop with TP (no ladder)
  policies.push({
    kind: 'fixed_stop',
    stopPct: FIXED_SL_PCT,
    takeProfitPct: FIXED_TP_MULTIPLE - 1, // 5.45x = 445% gain
  });

  // 2. Fixed stop with TP + time stops
  for (const maxHoldMs of MAX_HOLD_MS_VALUES) {
    // Time stop with TP
    policies.push({
      kind: 'time_stop',
      maxHoldMs,
      takeProfitPct: FIXED_TP_MULTIPLE - 1,
    });
  }

  // 3. Ladder policies
  for (const ladderLevels of LADDER_CONFIGS) {
    if (ladderLevels.length === 0) continue; // Skip empty (handled above)

    policies.push({
      kind: 'ladder',
      levels: ladderLevels,
      stopPct: FIXED_SL_PCT, // Hard stop at 25%
    });
  }

  // 4. Combo: Fixed stop + time stop
  for (const maxHoldMs of MAX_HOLD_MS_VALUES) {
    policies.push({
      kind: 'combo',
      policies: [
        {
          kind: 'fixed_stop',
          stopPct: FIXED_SL_PCT,
          takeProfitPct: FIXED_TP_MULTIPLE - 1,
        },
        {
          kind: 'time_stop',
          maxHoldMs,
        },
      ],
    });
  }

  return policies;
}

/**
 * Main function - generates policy JSONs for manual optimization
 */
async function main() {
  const policies = generateRiskPolicies();

  console.log(`Generated ${policies.length} RiskPolicy configurations`);
  console.log('\nFixed parameters:');
  console.log(`- TP: ${FIXED_TP_MULTIPLE}x (${((FIXED_TP_MULTIPLE - 1) * 100).toFixed(0)}% gain)`);
  console.log(`- SL: ${(FIXED_SL_PCT * 100).toFixed(0)}% (${FIXED_SL_PCT})`);
  console.log('\nExplored parameters:');
  console.log(`- Max hold: ${MAX_HOLD_MS_VALUES.map((ms) => `${ms / (60 * 1000)}min`).join(', ')}`);
  console.log(`- Ladder configs: ${LADDER_CONFIGS.length} variants`);

  console.log('\n⚠️  Note: BE bailout is not supported in RiskPolicy system.');
  console.log('   Use exit-stack mode to test BE bailout separately.');
  console.log('\nTo use with existing optimizer:');
  console.log('  1. Modify POLICY_GRID in packages/backtest/src/policies/risk-policy.ts');
  console.log('  2. Or use these policies with backtest policy command');
  console.log('  3. Then test BE bailout variants using exit-stack mode');

  // Export policies
  const output = {
    fixedParams: {
      tpMultiple: FIXED_TP_MULTIPLE,
      slPct: FIXED_SL_PCT,
    },
    policies: policies.map((p, i) => ({
      policyId: `be_optimizer_${i}`,
      policy: p,
      policyJson: JSON.stringify(p),
    })),
  };

  const fs = await import('fs/promises');
  await fs.writeFile('be-bailout-risk-policies.json', JSON.stringify(output, null, 2));

  console.log(`\n✅ Exported ${policies.length} policies to be-bailout-risk-policies.json`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
