/**
 * Unit tests for Research OS Contract
 */

import { describe, it, expect } from 'vitest';
import {
  DataSnapshotRefSchema,
  StrategyRefSchema,
  ExecutionModelSchema,
  CostModelSchema,
  RiskModelSchema,
  RunConfigSchema,
  SimulationRequestSchema,
} from '../../../src/research/contract.js';

describe('Research OS Contract', () => {
  describe('DataSnapshotRef', () => {
    it('validates correct snapshot ref', () => {
      const ref = {
        snapshotId: 'snapshot-001',
        contentHash: 'a'.repeat(64), // SHA-256 hash
        timeRange: {
          fromISO: '2024-01-01T00:00:00Z',
          toISO: '2024-01-02T00:00:00Z',
        },
        sources: [{ venue: 'pump.fun', chain: 'solana' }],
        createdAtISO: '2024-01-01T00:00:00Z',
      };

      const result = DataSnapshotRefSchema.safeParse(ref);
      expect(result.success).toBe(true);
    });

    it('rejects invalid content hash', () => {
      const ref = {
        snapshotId: 'snapshot-001',
        contentHash: 'invalid-hash', // Not 64 hex chars
        timeRange: {
          fromISO: '2024-01-01T00:00:00Z',
          toISO: '2024-01-02T00:00:00Z',
        },
        sources: [],
        createdAtISO: '2024-01-01T00:00:00Z',
      };

      const result = DataSnapshotRefSchema.safeParse(ref);
      expect(result.success).toBe(false);
    });

    it('accepts optional filters', () => {
      const ref = {
        snapshotId: 'snapshot-001',
        contentHash: 'a'.repeat(64),
        timeRange: {
          fromISO: '2024-01-01T00:00:00Z',
          toISO: '2024-01-02T00:00:00Z',
        },
        sources: [],
        filters: {
          callerNames: ['caller1'],
          mintAddresses: ['mint1'],
          minVolume: 1000,
        },
        createdAtISO: '2024-01-01T00:00:00Z',
      };

      const result = DataSnapshotRefSchema.safeParse(ref);
      expect(result.success).toBe(true);
    });
  });

  describe('StrategyRef', () => {
    it('validates correct strategy ref', () => {
      const ref = {
        strategyId: 'strategy-001',
        name: 'momentum-breakout',
        config: { targets: [{ target: 2, percent: 0.5 }] },
        configHash: 'a'.repeat(64),
      };

      const result = StrategyRefSchema.safeParse(ref);
      expect(result.success).toBe(true);
    });

    it('rejects invalid config hash', () => {
      const ref = {
        strategyId: 'strategy-001',
        name: 'momentum-breakout',
        config: {},
        configHash: 'invalid',
      };

      const result = StrategyRefSchema.safeParse(ref);
      expect(result.success).toBe(false);
    });
  });

  describe('ExecutionModel', () => {
    it('validates correct execution model', () => {
      const model = {
        latency: {
          p50: 100,
          p90: 200,
          p99: 500,
        },
        slippage: {
          base: 0.001,
          volumeImpact: 0.0001,
        },
      };

      const result = ExecutionModelSchema.safeParse(model);
      expect(result.success).toBe(true);
    });

    it('rejects negative latency', () => {
      const model = {
        latency: {
          p50: -100, // Invalid
          p90: 200,
          p99: 500,
        },
        slippage: {
          base: 0.001,
        },
      };

      const result = ExecutionModelSchema.safeParse(model);
      expect(result.success).toBe(false);
    });

    it('accepts optional failures and partial fills', () => {
      const model = {
        latency: {
          p50: 100,
          p90: 200,
          p99: 500,
        },
        slippage: {
          base: 0.001,
        },
        failures: {
          baseRate: 0.01,
          congestionMultiplier: 1.5,
        },
        partialFills: {
          probability: 0.1,
          fillRange: [0.5, 0.9] as [number, number],
        },
      };

      const result = ExecutionModelSchema.safeParse(model);
      expect(result.success).toBe(true);
    });
  });

  describe('CostModel', () => {
    it('validates correct cost model', () => {
      const model = {
        baseFee: 5000,
        tradingFee: 0.01,
      };

      const result = CostModelSchema.safeParse(model);
      expect(result.success).toBe(true);
    });

    it('rejects negative fees', () => {
      const model = {
        baseFee: -100, // Invalid
        tradingFee: 0.01,
      };

      const result = CostModelSchema.safeParse(model);
      expect(result.success).toBe(false);
    });

    it('accepts optional priority fee and compute costs', () => {
      const model = {
        baseFee: 5000,
        priorityFee: {
          base: 1000,
          max: 10000,
        },
        computeUnitCost: 100,
        tradingFee: 0.01,
      };

      const result = CostModelSchema.safeParse(model);
      expect(result.success).toBe(true);
    });
  });

  describe('RiskModel', () => {
    it('validates correct risk model', () => {
      const model = {
        maxDrawdown: 0.2,
        maxLossPerDay: 1000,
        maxConsecutiveLosses: 5,
      };

      const result = RiskModelSchema.safeParse(model);
      expect(result.success).toBe(true);
    });

    it('accepts all optional fields', () => {
      const model = {
        maxDrawdown: 0.2,
        maxLossPerDay: 1000,
        maxConsecutiveLosses: 5,
        maxPositionSize: 500,
        maxTotalExposure: 10000,
        tradeThrottle: {
          maxTrades: 10,
          windowMinutes: 60,
        },
      };

      const result = RiskModelSchema.safeParse(model);
      expect(result.success).toBe(true);
    });
  });

  describe('RunConfig', () => {
    it('validates correct run config', () => {
      const config = {
        seed: 12345,
        timeResolutionMs: 1000,
        errorMode: 'collect' as const,
        includeEventLogs: true,
      };

      const result = RunConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('rejects invalid error mode', () => {
      const config = {
        seed: 12345,
        errorMode: 'invalid' as any,
      };

      const result = RunConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('applies defaults', () => {
      const config = {
        seed: 12345,
      };

      const result = RunConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.timeResolutionMs).toBe(1000);
        expect(result.data.errorMode).toBe('collect');
        expect(result.data.includeEventLogs).toBe(true);
      }
    });
  });

  describe('SimulationRequest', () => {
    it('validates complete simulation request', () => {
      const request = {
        dataSnapshot: {
          snapshotId: 'snapshot-001',
          contentHash: 'a'.repeat(64),
          timeRange: {
            fromISO: '2024-01-01T00:00:00Z',
            toISO: '2024-01-02T00:00:00Z',
          },
          sources: [],
          createdAtISO: '2024-01-01T00:00:00Z',
        },
        strategy: {
          strategyId: 'strategy-001',
          name: 'test',
          config: {},
          configHash: 'b'.repeat(64),
        },
        executionModel: {
          latency: { p50: 100, p90: 200, p99: 500 },
          slippage: { base: 0.001 },
        },
        costModel: {
          baseFee: 5000,
        },
        runConfig: {
          seed: 12345,
        },
      };

      const result = SimulationRequestSchema.safeParse(request);
      expect(result.success).toBe(true);
    });

    it('accepts optional risk model', () => {
      const request = {
        dataSnapshot: {
          snapshotId: 'snapshot-001',
          contentHash: 'a'.repeat(64),
          timeRange: {
            fromISO: '2024-01-01T00:00:00Z',
            toISO: '2024-01-02T00:00:00Z',
          },
          sources: [],
          createdAtISO: '2024-01-01T00:00:00Z',
        },
        strategy: {
          strategyId: 'strategy-001',
          name: 'test',
          config: {},
          configHash: 'b'.repeat(64),
        },
        executionModel: {
          latency: { p50: 100, p90: 200, p99: 500 },
          slippage: { base: 0.001 },
        },
        costModel: {
          baseFee: 5000,
        },
        riskModel: {
          maxDrawdown: 0.2,
        },
        runConfig: {
          seed: 12345,
        },
      };

      const result = SimulationRequestSchema.safeParse(request);
      expect(result.success).toBe(true);
    });
  });
});
