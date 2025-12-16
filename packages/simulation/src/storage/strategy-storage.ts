/**
 * Strategy Auto-Storage
 * =====================
 * Automatically stores strategies when they are used in simulations.
 *
 * @deprecated This has been moved to @quantbot/workflows.
 * Import from @quantbot/workflows/storage/strategy-storage instead.
 * This file will be removed in a future version.
 */

import { createHash } from 'crypto';
import { logger } from '@quantbot/utils';
import type { ScenarioConfig } from '../core/orchestrator';

/**
 * Generate a hash for strategy configuration
 */
export function hashStrategyConfig(scenario: ScenarioConfig): string {
  const configString = JSON.stringify({
    strategy: scenario.strategy,
    stopLoss: scenario.stopLoss,
    entry: scenario.entry,
    reEntry: scenario.reEntry,
    costs: scenario.costs,
    entrySignal: scenario.entrySignal,
    exitSignal: scenario.exitSignal,
  });

  return createHash('sha256').update(configString).digest('hex').substring(0, 16);
}

/**
 * Generate a strategy name from configuration
 */
export function generateStrategyName(scenario: ScenarioConfig): string {
  const strategyParts: string[] = [];

  // Add profit targets
  if (scenario.strategy.length > 0) {
    const targets = scenario.strategy.map((s) => `${s.target}x`).join('_');
    strategyParts.push(`PT${targets}`);
  }

  // Add stop loss
  if (scenario.stopLoss) {
    if (scenario.stopLoss.initial !== undefined) {
      const slPct = Math.abs(scenario.stopLoss.initial * 100).toFixed(0);
      strategyParts.push(`SL${slPct}`);
    }
    if (scenario.stopLoss.trailing !== undefined && scenario.stopLoss.trailing !== 'none') {
      const trailingPct = ((scenario.stopLoss.trailing as number) * 100).toFixed(0);
      strategyParts.push(`TS${trailingPct}`);
    }
  }

  // Add entry config
  if (scenario.entry) {
    if (scenario.entry.initialEntry !== 'none' && typeof scenario.entry.initialEntry === 'number') {
      const dropPct = Math.abs(scenario.entry.initialEntry * 100).toFixed(0);
      strategyParts.push(`ED${dropPct}`);
    }
    if (
      scenario.entry.trailingEntry !== 'none' &&
      typeof scenario.entry.trailingEntry === 'number'
    ) {
      const trailingPct = ((scenario.entry.trailingEntry as number) * 100).toFixed(0);
      strategyParts.push(`TE${trailingPct}`);
    }
  }

  // Add re-entry config
  if (scenario.reEntry && scenario.reEntry.trailingReEntry !== 'none') {
    const reEntryPct = ((scenario.reEntry.trailingReEntry as number) * 100).toFixed(0);
    strategyParts.push(`RE${reEntryPct}`);
  }

  const name = strategyParts.length > 0 ? strategyParts.join('_') : 'default';

  return name.toLowerCase();
}

/**
 * Auto-store strategy if it doesn't exist
 * @deprecated This function uses @quantbot/storage which violates architectural rules.
 * It should be moved to @quantbot/workflows.
 */
export async function ensureStrategyStored(_scenario: ScenarioConfig): Promise<number | null> {
  throw new Error(
    'ensureStrategyStored is deprecated and uses @quantbot/storage (forbidden in simulation package). ' +
      'Move this function to @quantbot/workflows or use dependency injection to provide storage client.'
  );
}
