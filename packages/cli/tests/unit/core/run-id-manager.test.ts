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
      expect(id1).toContain('simulation_run_duckdb');
      expect(id1).toContain('PT2_SL25');
      expect(id1).toContain('So11111');
      expect(id1).toContain('20240101120000');
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
      expect(id).toContain('simulation_run_duckdb');
      expect(id).not.toContain('.');
    });

    it('should truncate mint to 8 characters', () => {
      const components: RunIdComponents = {
        command: 'simulation.run-duckdb',
        strategyId: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alertTimestamp: '2024-01-01T12:00:00Z',
      };

      const id = generateRunId(components);
      const parts = id.split('_');
      const mintPart = parts[2]; // Format: command_strategyId_mintShort_timestamp_hash
      expect(mintPart).toBe('So11111');
      expect(mintPart.length).toBe(8);
    });
  });

  describe('parseRunId', () => {
    it('should parse run ID components', () => {
      const id = 'simulation_run_duckdb_PT2_SL25_So11111_20240101120000_a3f2b1c9';
      const parsed = parseRunId(id);

      expect(parsed.command).toBe('simulation_run_duckdb');
      expect(parsed.strategyId).toBe('PT2');
      expect(parsed.mintShort).toBe('So11111');
      expect(parsed.timestamp).toBe('20240101120000');
      expect(parsed.hash).toBeDefined();
    });

    it('should parse run ID with suffix', () => {
      const id = 'simulation_run_duckdb_PT2_SL25_So11111_20240101120000_a3f2b1c9_retry';
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
