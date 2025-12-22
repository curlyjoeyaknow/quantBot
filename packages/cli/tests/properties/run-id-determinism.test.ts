/**
 * Property tests for Run ID Determinism
 *
 * Critical invariants:
 * - Determinism: same inputs always produce same run ID
 * - Uniqueness: different inputs produce different run IDs
 * - Format: run IDs match expected pattern
 */

import { describe, it, expect } from 'vitest';
import { generateRunId, type RunIdComponents } from '../../src/core/run-id-manager.js';

describe('Run ID Determinism - Property Tests', () => {
  describe('Determinism Invariant', () => {
    it('should produce identical IDs for identical inputs', () => {
      const components: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
      };

      const id1 = generateRunId(components);
      const id2 = generateRunId(components);
      const id3 = generateRunId(components);

      expect(id1).toBe(id2);
      expect(id2).toBe(id3);
    });

    it('should produce identical IDs across multiple calls', () => {
      const components: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
        callerName: 'test_caller',
        suffix: 'retry',
      };

      const ids = Array.from({ length: 100 }, () => generateRunId(components));
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(1);
    });
  });

  describe('Uniqueness Invariant', () => {
    it('should produce different IDs for different commands', () => {
      const base: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
      };

      const id1 = generateRunId(base);
      const id2 = generateRunId({ ...base, command: 'simulation.store-run-duckdb' });

      expect(id1).not.toBe(id2);
    });

    it('should produce different IDs for different strategy IDs', () => {
      const base: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
      };

      const id1 = generateRunId(base);
      const id2 = generateRunId({ ...base, strategyId: 'PT3_SL30' });

      expect(id1).not.toBe(id2);
    });

    it('should produce different IDs for different mints', () => {
      const base: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
      };

      const id1 = generateRunId(base);
      const id2 = generateRunId({
        ...base,
        mint: 'So22222222222222222222222222222222222222223',
      });

      expect(id1).not.toBe(id2);
    });

    it('should produce different IDs for different timestamps', () => {
      const base: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
      };

      const id1 = generateRunId(base);
      const id2 = generateRunId({ ...base, alertTimestamp: '2024-01-02T12:00:00Z' });

      expect(id1).not.toBe(id2);
    });

    it('should produce different IDs for different caller names', () => {
      const base: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
      };

      const id1 = generateRunId(base);
      const id2 = generateRunId({ ...base, callerName: 'test_caller' });

      expect(id1).not.toBe(id2);
    });

    it('should produce different IDs for different suffixes', () => {
      const base: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
      };

      const id1 = generateRunId(base);
      const id2 = generateRunId({ ...base, suffix: 'retry' });

      expect(id1).not.toBe(id2);
    });
  });

  describe('Format Invariant', () => {
    it('should match expected format pattern', () => {
      const components: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
      };

      const id = generateRunId(components);
      const parts = id.split('_');

      // Format: command_strategyId_mintShort_timestamp_hash
      // Command may have multiple parts after dot replacement
      expect(parts.length).toBeGreaterThanOrEqual(5);
      expect(id).toContain('simulation');
      expect(id).toContain('run');
      // Find strategyId, mintShort, timestamp, hash in the parts
      expect(id).toContain('PT2_SL25');
      const mintPart = parts.find((p) => p.startsWith('So') && p.length === 8);
      const timestampPart = parts.find((p) => /^\d{14}$/.test(p));
      const hashPart = parts.find((p) => /^[a-f0-9]{8}$/.test(p));

      expect(mintPart).toBe('So111111'); // 8 characters
      expect(timestampPart).toMatch(/^\d{14}$/); // yyyyMMddHHmmss
      expect(hashPart).toMatch(/^[a-f0-9]{8}$/); // 8-char hex hash
    });

    it('should include suffix when provided', () => {
      const components: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
        suffix: 'retry',
      };

      const id = generateRunId(components);
      expect(id).toContain('retry');
      expect(id.split('_').pop()).toBe('retry');
    });

    it('should replace dots in command name with underscores', () => {
      const components: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
      };

      const id = generateRunId(components);
      expect(id).not.toContain('.');
      expect(id).toContain('_');
    });
  });
});
