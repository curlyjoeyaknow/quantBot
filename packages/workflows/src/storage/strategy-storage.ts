/**
 * Strategy Auto-Storage
 * =====================
 * Automatically stores strategies when they are used in simulations.
 */

import { createHash } from 'crypto';
import { getStorageEngine } from '@quantbot/storage';
import { logger } from '@quantbot/utils';
import type { ScenarioConfig } from '../simulation/orchestrator';

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
 */
export async function ensureStrategyStored(scenario: ScenarioConfig): Promise<number | null> {
  try {
    const storageEngine = getStorageEngine();
    const strategiesRepo = (storageEngine as any).strategiesRepo;

    if (!strategiesRepo) {
      logger.warn('Strategies repository not available, skipping auto-storage');
      return null;
    }

    const strategyName = generateStrategyName(scenario);
    const configHash = hashStrategyConfig(scenario);

    // Check if strategy already exists
    const existing = await strategiesRepo.findByName(strategyName, '1');
    if (existing) {
      logger.debug('Strategy already exists', { name: strategyName, id: existing.id });
      return existing.id;
    }

    // Create new strategy
    const strategyId = await strategiesRepo.create({
      name: strategyName,
      version: '1',
      category: 'auto-generated',
      description: `Auto-generated strategy from simulation run (hash: ${configHash})`,
      config: {
        strategy: scenario.strategy,
        stopLoss: scenario.stopLoss,
        entry: scenario.entry,
        reEntry: scenario.reEntry,
        costs: scenario.costs,
        entrySignal: scenario.entrySignal,
        exitSignal: scenario.exitSignal,
      },
      isActive: true,
    });

    logger.info('Auto-stored strategy', { id: strategyId, name: strategyName });
    return strategyId;
  } catch (error) {
    logger.warn('Failed to auto-store strategy', error as Error);
    return null;
  }
}
