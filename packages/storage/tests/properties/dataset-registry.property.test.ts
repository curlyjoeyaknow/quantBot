/**
 * Property Tests for Dataset Registry
 * ====================================
 *
 * Tests critical invariants for dataset registry operations.
 *
 * Critical Invariants:
 * 1. Lookups are consistent (same ID → same metadata)
 * 2. Metadata structure is valid
 * 3. Type filtering works correctly
 * 4. Dataset IDs are unique
 * 5. Default columns are always defined for registered datasets
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { datasetRegistry, initializeDefaultDatasets } from '../../src/adapters/dataset-registry.js';
import type { DatasetMetadata } from '../../src/adapters/dataset-registry.js';

describe('Dataset Registry - Property Tests', () => {
  // Generate valid dataset IDs
  const datasetIdArb = fc.oneof(
    fc.constant('candles_1s'),
    fc.constant('candles_15s'),
    fc.constant('candles_1m'),
    fc.constant('candles_5m'),
    fc.constant('indicators_1m')
  );

  describe('Lookup Consistency (Critical Invariant)', () => {
    it('should return identical metadata for same dataset ID', () => {
      fc.assert(
        fc.property(datasetIdArb, (datasetId) => {
          const metadata1 = datasetRegistry.get(datasetId);
          const metadata2 = datasetRegistry.get(datasetId);

          // Should return same reference or equal values
          if (metadata1 === undefined && metadata2 === undefined) {
            return true;
          }

          if (metadata1 === undefined || metadata2 === undefined) {
            return false;
          }

          // Compare all properties
          return (
            metadata1.datasetId === metadata2.datasetId &&
            metadata1.type === metadata2.type &&
            metadata1.tableName === metadata2.tableName &&
            metadata1.interval === metadata2.interval &&
            metadata1.conditional === metadata2.conditional
          );
        }),
        { numRuns: 10 }
      );
    });
  });

  describe('Metadata Validity (Critical Invariant)', () => {
    it('should return valid metadata structure for registered datasets', () => {
      fc.assert(
        fc.property(datasetIdArb, (datasetId) => {
          const metadata = datasetRegistry.get(datasetId);

          if (metadata === undefined) {
            return false; // Should be registered
          }

          // Required fields
          if (!metadata.datasetId || !metadata.type || !metadata.tableName) {
            return false;
          }

          // Type should be valid
          if (metadata.type !== 'candles' && metadata.type !== 'indicators') {
            return false;
          }

          // Dataset ID should match
          if (metadata.datasetId !== datasetId) {
            return false;
          }

          // Default columns should be defined
          if (!metadata.defaultColumns || metadata.defaultColumns.length === 0) {
            return false;
          }

          return true;
        }),
        { numRuns: 10 }
      );
    });
  });

  describe('Type Filtering (Critical Invariant)', () => {
    it('should filter datasets by type correctly', () => {
      fc.assert(
        fc.property(fc.oneof(fc.constant('candles'), fc.constant('indicators')), (type) => {
          const filtered = datasetRegistry.getByType(type);

          // All returned datasets should have the correct type
          for (const dataset of filtered) {
            if (dataset.type !== type) {
              return false;
            }
          }

          // Should return at least one dataset for known types
          if (type === 'candles' || type === 'indicators') {
            return filtered.length > 0;
          }

          return true;
        }),
        { numRuns: 10 }
      );
    });
  });

  describe('Dataset Uniqueness (Critical Invariant)', () => {
    it('should not have duplicate dataset IDs', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const allDatasets = datasetRegistry.getAll();
          const datasetIds = allDatasets.map((d) => d.datasetId);

          // Check for duplicates
          const uniqueIds = new Set(datasetIds);
          return uniqueIds.size === datasetIds.length;
        }),
        { numRuns: 1 }
      );
    });
  });

  describe('Default Columns (Critical Invariant)', () => {
    it('should have default columns for all registered datasets', () => {
      fc.assert(
        fc.property(datasetIdArb, (datasetId) => {
          const metadata = datasetRegistry.get(datasetId);

          if (metadata === undefined) {
            return false;
          }

          // Default columns should be defined and non-empty
          return (
            metadata.defaultColumns !== undefined &&
            Array.isArray(metadata.defaultColumns) &&
            metadata.defaultColumns.length > 0
          );
        }),
        { numRuns: 10 }
      );
    });

    it('should have consistent column structure for candle datasets', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant('candles_1s'),
            fc.constant('candles_15s'),
            fc.constant('candles_1m'),
            fc.constant('candles_5m')
          ),
          (datasetId) => {
            const metadata = datasetRegistry.get(datasetId);

            if (metadata === undefined || metadata.type !== 'candles') {
              return false;
            }

            // Candle datasets should have standard OHLCV columns
            const requiredColumns = [
              'token_address',
              'chain',
              'timestamp',
              'interval',
              'open',
              'high',
              'low',
              'close',
              'volume',
            ];

            for (const col of requiredColumns) {
              if (!metadata.defaultColumns?.includes(col)) {
                return false;
              }
            }

            return true;
          }
        ),
        { numRuns: 10 }
      );
    });
  });
});
