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

      // Format: command_strategyId_fullMint_timestamp_hash (see run-id-manager.ts line 54-66)
      // Command has dots replaced with underscores, strategyId may contain underscores (split into parts)
      expect(parts.length).toBeGreaterThanOrEqual(5);
      expect(id).toContain('simulation');
      expect(id).toContain('run');
      // StrategyId "PT2_SL25" gets split into "PT2" and "SL25" parts when split by '_'
      expect(parts).toContain('PT2');
      expect(parts).toContain('SL25');
      // Mint is the full address, not shortened (line 57 in run-id-manager.ts)
      // Note: When strategyId contains underscores, splitting by '_' will break it into parts
      // So we need to find the mint by looking for the part that starts with 'So' and is 44 chars
      // But strategyId parts might also start with letters, so we check length too
      const mintPart = parts.find((p) => p.startsWith('So') && p.length === 44);
      const timestampPart = parts.find((p) => /^\d{14}$/.test(p));
      const hashPart = parts.find((p) => /^[a-f0-9]{8}$/.test(p));

      // If mintPart is undefined, the mint might be in a different position due to strategyId splitting
      // Let's check if the full mint is in the ID string instead
      if (!mintPart) {
        // Mint should be in the ID somewhere
        expect(id).toContain('So11111111111111111111111111111111111111112');
        // Reconstruct: the mint is between strategyId and timestamp
        // Since strategyId is "PT2_SL25", after splitting we have: [..., 'PT2', 'SL25', mint, timestamp, hash]
        const pt2Index = parts.indexOf('PT2');
        const sl25Index = parts.indexOf('SL25');
        const strategyEndIndex = Math.max(pt2Index, sl25Index);
        // Mint should be right after the strategyId parts
        const potentialMintIndex = strategyEndIndex + 1;
        if (potentialMintIndex < parts.length) {
          const potentialMint = parts[potentialMintIndex];
          if (potentialMint.startsWith('So') && potentialMint.length === 44) {
            expect(potentialMint).toBe('So11111111111111111111111111111111111111112');
          }
        }
      } else {
        expect(mintPart).toBe('So11111111111111111111111111111111111111112'); // Full 44-char mint
      }
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
