/**
 * Dataset Registry
 *
 * Centralized registry for all supported datasets in the slice export system.
 * Supports both candle datasets (OHLCV) and indicator datasets.
 */

import { getClickHouseClient } from '../clickhouse-client.js';
import { logger } from '@quantbot/infra/utils';

/**
 * Dataset type classification
 */
export type DatasetType = 'candles' | 'indicators';

/**
 * Dataset metadata
 */
export interface DatasetMetadata {
  /**
   * Dataset identifier (e.g., 'candles_1m', 'indicators_1m')
   */
  datasetId: string;

  /**
   * Dataset type
   */
  type: DatasetType;

  /**
   * ClickHouse table name
   */
  tableName: string;

  /**
   * Interval/granularity (for candles) or indicator type (for indicators)
   */
  interval?: string;

  /**
   * Whether this dataset is conditionally available (requires table check)
   */
  conditional?: boolean;

  /**
   * Default columns to export
   */
  defaultColumns?: string[];
}

/**
 * Dataset registry
 */
class DatasetRegistry {
  private datasets: Map<string, DatasetMetadata> = new Map();

  /**
   * Register a dataset
   */
  register(metadata: DatasetMetadata): void {
    this.datasets.set(metadata.datasetId, metadata);
  }

  /**
   * Get dataset metadata
   */
  get(datasetId: string): DatasetMetadata | undefined {
    return this.datasets.get(datasetId);
  }

  /**
   * Get all registered datasets
   */
  getAll(): DatasetMetadata[] {
    return Array.from(this.datasets.values());
  }

  /**
   * Get all datasets of a specific type
   */
  getByType(type: DatasetType): DatasetMetadata[] {
    return Array.from(this.datasets.values()).filter((d) => d.type === type);
  }

  /**
   * Check if a dataset is available in ClickHouse
   */
  async isAvailable(datasetId: string): Promise<boolean> {
    const metadata = this.get(datasetId);
    if (!metadata) {
      return false;
    }

    // Non-conditional datasets are always available
    if (!metadata.conditional) {
      return true;
    }

    // For conditional datasets, check if table exists
    try {
      const ch = getClickHouseClient();
      const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

      const result = await ch.query({
        query: `
          SELECT count() as cnt
          FROM system.tables
          WHERE database = '${CLICKHOUSE_DATABASE}'
            AND name = '${metadata.tableName}'
        `,
        format: 'JSONEachRow',
      });

      const data = (await result.json()) as Array<{ cnt: string }>;
      return data.length > 0 && parseInt(data[0]?.cnt || '0', 10) > 0;
    } catch (error) {
      logger.warn('Failed to check dataset availability', {
        datasetId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Get available datasets (filters out unavailable conditional datasets)
   */
  async getAvailable(): Promise<DatasetMetadata[]> {
    const all = this.getAll();
    const available: DatasetMetadata[] = [];

    for (const dataset of all) {
      if (await this.isAvailable(dataset.datasetId)) {
        available.push(dataset);
      }
    }

    return available;
  }
}

/**
 * Global dataset registry instance
 */
export const datasetRegistry = new DatasetRegistry();

/**
 * Initialize default datasets
 */
export function initializeDefaultDatasets(): void {
  // Candle datasets
  datasetRegistry.register({
    datasetId: 'candles_1s',
    type: 'candles',
    tableName: 'ohlcv_candles',
    interval: '1s',
    defaultColumns: [
      'token_address',
      'chain',
      'timestamp',
      'interval',
      'open',
      'high',
      'low',
      'close',
      'volume',
    ],
  });

  datasetRegistry.register({
    datasetId: 'candles_15s',
    type: 'candles',
    tableName: 'ohlcv_candles',
    interval: '15s',
    defaultColumns: [
      'token_address',
      'chain',
      'timestamp',
      'interval',
      'open',
      'high',
      'low',
      'close',
      'volume',
    ],
  });

  datasetRegistry.register({
    datasetId: 'candles_1m',
    type: 'candles',
    tableName: 'ohlcv_candles',
    interval: '1m',
    defaultColumns: [
      'token_address',
      'chain',
      'timestamp',
      'interval',
      'open',
      'high',
      'low',
      'close',
      'volume',
    ],
  });

  datasetRegistry.register({
    datasetId: 'candles_5m',
    type: 'candles',
    tableName: 'ohlcv_candles',
    interval: '5m',
    defaultColumns: [
      'token_address',
      'chain',
      'timestamp',
      'interval',
      'open',
      'high',
      'low',
      'close',
      'volume',
    ],
  });

  // Indicator datasets (conditional - only if table exists)
  datasetRegistry.register({
    datasetId: 'indicators_1m',
    type: 'indicators',
    tableName: 'indicator_values',
    interval: '1m',
    conditional: true,
    defaultColumns: [
      'token_address',
      'chain',
      'timestamp',
      'indicator_type',
      'value_json',
      'metadata_json',
    ],
  });
}

// Initialize on module load
initializeDefaultDatasets();
