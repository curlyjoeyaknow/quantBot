import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { DefaultTargetResolver } from '../src/target-resolver';
import type { SimulationScenarioConfig } from '../src/config';

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(),
    },
  };
});

describe('target-resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('DefaultTargetResolver', () => {
    const resolver = new DefaultTargetResolver();

    describe('fromMint', () => {
      it('should resolve mint target with start and end times', async () => {
        const scenario: SimulationScenarioConfig = {
          name: 'test',
          strategy: {
            entry: { type: 'market' },
            targets: [{ percent: 1.0, target: 2 }],
            stopLoss: { type: 'fixed', value: 0.1 },
          },
          data: {
            kind: 'mint',
            mint: 'So11111111111111111111111111111111111111112',
            chain: 'solana',
            start: '2024-01-01T00:00:00Z',
            end: '2024-01-02T00:00:00Z',
          },
        };

        const targets = await resolver.resolve(scenario);

        expect(targets).toHaveLength(1);
        expect(targets[0].mint).toBe('So11111111111111111111111111111111111111112');
        expect(targets[0].chain).toBe('solana');
        expect(targets[0].startTime.toISO()).toContain('2024-01-01');
        expect(targets[0].endTime.toISO()).toContain('2024-01-02');
      });

      it('should resolve mint target with start and duration', async () => {
        const scenario: SimulationScenarioConfig = {
          name: 'test',
          strategy: {
            entry: { type: 'market' },
            targets: [{ percent: 1.0, target: 2 }],
            stopLoss: { type: 'fixed', value: 0.1 },
          },
          data: {
            kind: 'mint',
            mint: 'So11111111111111111111111111111111111111112',
            start: '2024-01-01T00:00:00Z',
            durationHours: 24,
          },
        };

        const targets = await resolver.resolve(scenario);

        expect(targets).toHaveLength(1);
        expect(targets[0].endTime.toSeconds() - targets[0].startTime.toSeconds()).toBeCloseTo(
          24 * 3600,
          0
        );
      });

      it('should throw error for invalid start time', async () => {
        const scenario: SimulationScenarioConfig = {
          name: 'test',
          strategy: {
            entry: { type: 'market' },
            targets: [{ percent: 1.0, target: 2 }],
            stopLoss: { type: 'fixed', value: 0.1 },
          },
          data: {
            kind: 'mint',
            mint: 'So11111111111111111111111111111111111111112',
            start: 'invalid-date',
          },
        };

        await expect(resolver.resolve(scenario)).rejects.toThrow('Invalid ISO timestamp');
      });

      it('should use default chain when not specified', async () => {
        const scenario: SimulationScenarioConfig = {
          name: 'test',
          strategy: {
            entry: { type: 'market' },
            targets: [{ percent: 1.0, target: 2 }],
            stopLoss: { type: 'fixed', value: 0.1 },
          },
          data: {
            kind: 'mint',
            mint: 'So11111111111111111111111111111111111111112',
            start: '2024-01-01T00:00:00Z',
            durationHours: 24,
          },
        };

        const targets = await resolver.resolve(scenario);

        expect(targets[0].chain).toBe('solana');
      });
    });

    describe('fromFile', () => {
      it('should throw error for unsupported caller kind', async () => {
        const scenario: SimulationScenarioConfig = {
          name: 'test',
          strategy: {
            entry: { type: 'market' },
            targets: [{ percent: 1.0, target: 2 }],
            stopLoss: { type: 'fixed', value: 0.1 },
          },
          data: {
            kind: 'caller',
          } as any,
        };

        await expect(resolver.resolve(scenario)).rejects.toThrow(
          'Caller-based data selection is not yet implemented'
        );
      });

      it('should throw error for unsupported dataset kind', async () => {
        const scenario: SimulationScenarioConfig = {
          name: 'test',
          strategy: {
            entry: { type: 'market' },
            targets: [{ percent: 1.0, target: 2 }],
            stopLoss: { type: 'fixed', value: 0.1 },
          },
          data: {
            kind: 'dataset',
          } as any,
        };

        await expect(resolver.resolve(scenario)).rejects.toThrow(
          'Dataset-based data selection is not yet implemented'
        );
      });
    });
  });
});
