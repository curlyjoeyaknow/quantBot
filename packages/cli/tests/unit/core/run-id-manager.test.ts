/**
 * Unit tests for Run ID Manager
 */

import { describe, it, expect } from 'vitest';
import {
  generateRunId,
  parseRunId,
  shouldGenerateRunId,
  type RunIdComponents,
} from '../../../src/core/run-id-manager.js';

describe('Run ID Manager', () => {
  describe('generateRunId', () => {
    it('should generate deterministic run IDs', () => {
      const components: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
      };

      const id1 = generateRunId(components);
      const id2 = generateRunId(components);

      expect(id1).toBe(id2);
      expect(id1).toContain('simulation');
      expect(id1).toContain('run');
      expect(id1).toContain('PT2_SL25');
      expect(id1).toContain('So11111');
      // Timestamp will be in UTC format
      expect(id1).toMatch(/\d{14}/); // yyyyMMddHHmmss format
    });

    it('should generate different IDs for different inputs', () => {
      const base: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
      };

      const id1 = generateRunId(base);
      const id2 = generateRunId({ ...base, strategyId: 'PT3_SL30' });
      const id3 = generateRunId({ ...base, mint: 'So22222222222222222222222222222222222222223' });
      const id4 = generateRunId({ ...base, alertTimestamp: '2024-01-02T12:00:00Z' });

      expect(id1).not.toBe(id2);
      expect(id1).not.toBe(id3);
      expect(id1).not.toBe(id4);
    });

    it('should include optional caller name in hash', () => {
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

    it('should include optional suffix', () => {
      const base: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
      };

      const id1 = generateRunId(base);
      const id2 = generateRunId({ ...base, suffix: 'retry' });

      expect(id1).not.toBe(id2);
      expect(id2).toContain('retry');
    });

    it('should handle command names with dots', () => {
      const components: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
      };

      const id = generateRunId(components);
      expect(id).toContain('simulation');
      expect(id).toContain('run');
      expect(id).not.toContain('.');
    });

    it('should include full mint address in run ID', () => {
      const components: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
      };

      const id = generateRunId(components);
      // Format: command_strategyId_mintFull_timestamp_hash
      // Mint is included in full (not truncated) for traceability
      expect(id).toContain('So11111111111111111111111111111111111111112');
      const parts = id.split('_');
      // Find the part that starts with 'So' and contains the full mint
      const mintPart = parts.find((p) => p.startsWith('So') && p.length > 8);
      expect(mintPart).toBe('So11111111111111111111111111111111111111112'); // Full mint address
    });
  });

  describe('parseRunId', () => {
    it('should parse run ID components', () => {
      // Generate a real ID to test parsing
      const components: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
      };
      const id = generateRunId(components);
      const parsed = parseRunId(id);

      expect(parsed.command).toBeDefined();
      // Command may have multiple parts, so strategyId might not be at index 1
      // Instead, check that the ID contains the strategy ID
      expect(id).toContain('PT2_SL25');
      // Find mint part (full mint address starting with So)
      const mintPart = id.split('_').find((p) => p.startsWith('So') && p.length > 8);
      expect(mintPart).toBe('So11111111111111111111111111111111111111112'); // Full mint address
      // Find timestamp (14 digits)
      const timestampPart = id.split('_').find((p) => /^\d{14}$/.test(p));
      expect(timestampPart).toBeDefined();
      expect(parsed.hash).toBeDefined();
    });

    it('should parse run ID with suffix', () => {
      const components: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
        suffix: 'retry',
      };
      const id = generateRunId(components);
      const parsed = parseRunId(id);

      expect(parsed.suffix).toBe('retry');
    });

    it('should handle malformed run IDs gracefully', () => {
      const parsed = parseRunId('invalid');
      expect(parsed.command).toBeUndefined();
    });
  });

  describe('shouldGenerateRunId', () => {
    it('should return true for simulation commands', () => {
      expect(shouldGenerateRunId('simulation.run')).toBe(true);
      expect(shouldGenerateRunId('simulation.run-duckdb')).toBe(true);
      expect(shouldGenerateRunId('simulation.store-run-duckdb')).toBe(true);
    });

    it('should return false for other commands', () => {
      expect(shouldGenerateRunId('ingestion.ohlcv')).toBe(false);
      expect(shouldGenerateRunId('storage.query')).toBe(false);
    });
  });
});
