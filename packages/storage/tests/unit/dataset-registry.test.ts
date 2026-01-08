/**
 * Dataset Registry Unit Tests
 *
 * Tests for the centralized dataset registry system.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  datasetRegistry,
  initializeDefaultDatasets,
  type DatasetMetadata,
} from '../../src/adapters/dataset-registry.js';
import { getClickHouseClient } from '../../src/clickhouse-client.js';

// Mock ClickHouse client
vi.mock('../../src/clickhouse-client.js', () => ({
  getClickHouseClient: vi.fn(),
}));

describe('Dataset Registry', () => {
  beforeEach(() => {
    // Clear registry before each test
    // Note: We can't easily reset the singleton, so we test with the initialized state
  });

  describe('Default Datasets', () => {
    it('should register all default candle datasets', () => {
      const candleDatasets = datasetRegistry.getByType('candles');
      const datasetIds = candleDatasets.map((d) => d.datasetId).sort();

      expect(datasetIds).toContain('candles_1s');
      expect(datasetIds).toContain('candles_15s');
      expect(datasetIds).toContain('candles_1m');
      expect(datasetIds).toContain('candles_5m');
    });

    it('should register indicators_1m dataset', () => {
      const indicatorDatasets = datasetRegistry.getByType('indicators');
      const datasetIds = indicatorDatasets.map((d) => d.datasetId);

      expect(datasetIds).toContain('indicators_1m');
    });

    it('should have correct metadata for candles_5m', () => {
      const metadata = datasetRegistry.get('candles_5m');
      expect(metadata).toBeDefined();
      expect(metadata?.type).toBe('candles');
      expect(metadata?.tableName).toBe('ohlcv_candles');
      expect(metadata?.interval).toBe('5m');
      expect(metadata?.conditional).toBeUndefined(); // Not conditional
      expect(metadata?.defaultColumns).toContain('token_address');
      expect(metadata?.defaultColumns).toContain('interval');
    });

    it('should have correct metadata for indicators_1m', () => {
      const metadata = datasetRegistry.get('indicators_1m');
      expect(metadata).toBeDefined();
      expect(metadata?.type).toBe('indicators');
      expect(metadata?.tableName).toBe('indicator_values');
      expect(metadata?.interval).toBe('1m');
      expect(metadata?.conditional).toBe(true);
      expect(metadata?.defaultColumns).toContain('indicator_type');
      expect(metadata?.defaultColumns).toContain('value_json');
    });
  });

  describe('Dataset Lookup', () => {
    it('should get dataset by ID', () => {
      const metadata = datasetRegistry.get('candles_1m');
      expect(metadata).toBeDefined();
      expect(metadata?.datasetId).toBe('candles_1m');
    });

    it('should return undefined for unknown dataset', () => {
      const metadata = datasetRegistry.get('unknown_dataset');
      expect(metadata).toBeUndefined();
    });

    it('should get all datasets', () => {
      const all = datasetRegistry.getAll();
      expect(all.length).toBeGreaterThanOrEqual(5); // At least 5 default datasets
    });

    it('should filter datasets by type', () => {
      const candleDatasets = datasetRegistry.getByType('candles');
      expect(candleDatasets.every((d) => d.type === 'candles')).toBe(true);

      const indicatorDatasets = datasetRegistry.getByType('indicators');
      expect(indicatorDatasets.every((d) => d.type === 'indicators')).toBe(true);
    });
  });

  describe('Conditional Dataset Availability', () => {
    it('should return true for non-conditional datasets', async () => {
      const isAvailable = await datasetRegistry.isAvailable('candles_1m');
      expect(isAvailable).toBe(true);
    });

    it('should check ClickHouse for conditional datasets', async () => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({
          json: async () => [{ cnt: '1' }],
        }),
      };

      vi.mocked(getClickHouseClient).mockReturnValue(mockClient as any);

      const isAvailable = await datasetRegistry.isAvailable('indicators_1m');
      expect(isAvailable).toBe(true);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining('system.tables'),
        })
      );
    });

    it('should return false if conditional dataset table does not exist', async () => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({
          json: async () => [{ cnt: '0' }],
        }),
      };

      vi.mocked(getClickHouseClient).mockReturnValue(mockClient as any);

      const isAvailable = await datasetRegistry.isAvailable('indicators_1m');
      expect(isAvailable).toBe(false);
    });

    it('should return false if conditional dataset check fails', async () => {
      const mockClient = {
        query: vi.fn().mockRejectedValue(new Error('Connection failed')),
      };

      vi.mocked(getClickHouseClient).mockReturnValue(mockClient as any);

      const isAvailable = await datasetRegistry.isAvailable('indicators_1m');
      expect(isAvailable).toBe(false);
    });

    it('should return false for unknown dataset', async () => {
      const isAvailable = await datasetRegistry.isAvailable('unknown_dataset');
      expect(isAvailable).toBe(false);
    });
  });

  describe('Get Available Datasets', () => {
    it('should return all non-conditional datasets', async () => {
      const available = await datasetRegistry.getAvailable();
      const candleDatasets = available.filter((d) => d.type === 'candles');

      // All candle datasets should be available (non-conditional)
      expect(candleDatasets.length).toBeGreaterThanOrEqual(4);
      expect(candleDatasets.map((d) => d.datasetId)).toContain('candles_1m');
    });

    it('should filter out unavailable conditional datasets', async () => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({
          json: async () => [{ cnt: '0' }], // Table doesn't exist
        }),
      };

      vi.mocked(getClickHouseClient).mockReturnValue(mockClient as any);

      const available = await datasetRegistry.getAvailable();
      const indicatorDatasets = available.filter((d) => d.type === 'indicators');

      // indicators_1m should be filtered out if table doesn't exist
      expect(indicatorDatasets.length).toBe(0);
    });
  });
});
