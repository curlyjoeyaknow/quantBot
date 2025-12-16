/**
 * Storage Sink
 * ============
 * Sink that automatically stores simulation results to Postgres and ClickHouse.
 *
 * @deprecated This sink has been moved to @quantbot/workflows.
 * Import from @quantbot/workflows/storage/storage-sink instead.
 * This file will be removed in a future version.
 */

import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import type { SimulationRunContext } from '../core/orchestrator';
import type { SimulationResultSink } from '../core/orchestrator';
import { calculateResultMetrics } from './metrics-calculator';
import { ensureStrategyStored, hashStrategyConfig } from './strategy-storage';

/**
 * Storage sink configuration
 */
export interface StorageSinkConfig {
  /** Auto-store strategies when used */
  autoStoreStrategies?: boolean;
  /** Engine version string */
  engineVersion?: string;
  /** Run type (backtest, optimization, what-if, etc.) */
  runType?: string;
  /** Enable/disable storage */
  enabled?: boolean;
}

/**
 * Default storage sink configuration
 */
export const DEFAULT_STORAGE_SINK_CONFIG: StorageSinkConfig = {
  autoStoreStrategies: true,
  engineVersion: '1.0.0',
  runType: 'backtest',
  enabled: true,
};

/**
 * Storage sink implementation
 * @deprecated This sink uses @quantbot/storage which violates architectural rules.
 * It should be moved to @quantbot/workflows.
 */
export class StorageSink implements SimulationResultSink {
  readonly name = 'storage-sink';
  private readonly config: StorageSinkConfig;

  constructor(config: StorageSinkConfig = {}) {
    this.config = { ...DEFAULT_STORAGE_SINK_CONFIG, ...config };
  }

  async handle(_context: SimulationRunContext): Promise<void> {
    throw new Error(
      'StorageSink is deprecated and uses @quantbot/storage (forbidden in simulation package). ' +
        'Move this sink to @quantbot/workflows or use dependency injection to provide storage client.'
    );
  }
}

/**
 * Create a storage sink
 */
export function createStorageSink(config?: StorageSinkConfig): StorageSink {
  return new StorageSink(config);
}
