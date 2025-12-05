import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { DateTime } from 'luxon';
import { ConfigDrivenSink } from '../../src/simulation/sinks';
import type { SimulationRunContext } from '../../src/simulation/engine';
import type { Scenario, Target } from '../../src/simulation/config';

// Mock ClickHouse client
vi.mock('../../src/storage/clickhouse-client', () => ({
  getClickHouseClient: vi.fn(() => ({
    insert: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      appendFile: vi.fn().mockResolvedValue(undefined),
    },
  };
});

describe('ConfigDrivenSink', () => {
  const mockScenario: Scenario = {
    name: 'test-scenario',
    strategy: {
      entry: { type: 'market' },
      targets: [{ percent: 0.5, multiple: 2 }],
      stopLoss: { type: 'fixed', value: 0.1 },
    },
  };

  const mockTarget: Target = {
    mint: 'So11111111111111111111111111111111111111112',
    chain: 'solana',
    startTime: DateTime.fromSeconds(1000),
    endTime: DateTime.fromSeconds(2000),
    metadata: {
      tokenSymbol: 'TEST',
      tokenName: 'Test Token',
    },
  };

  const mockResult = {
    finalPnl: 1.1,
    entryPrice: 1.0,
    finalPrice: 1.1,
    totalCandles: 100,
    events: [
      {
        timestamp: 1000,
        type: 'entry' as const,
        price: 1.0,
        remainingPosition: 1.0,
        pnlSoFar: 0,
      },
      {
        timestamp: 2000,
        type: 'exit' as const,
        price: 1.1,
        remainingPosition: 0,
        pnlSoFar: 0.1,
      },
    ],
  };

  const createContext = (overrides?: Partial<SimulationRunContext>): SimulationRunContext => ({
    scenario: mockScenario,
    target: mockTarget,
    result: mockResult,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock console.log
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('stdout output', () => {
    it('should write summary to stdout by default', async () => {
      const sink = new ConfigDrivenSink();
      const context = createContext();

      await sink.handle(context);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[simulation]'),
      );
    });

    it('should write detailed output when configured', async () => {
      const sink = new ConfigDrivenSink({
        defaultOutputs: [{ type: 'stdout', detail: 'detailed' }],
      });
      const context = createContext();

      await sink.handle(context);

      expect(console.log).toHaveBeenCalledWith(
        '[simulation]',
        expect.objectContaining({
          scenario: 'test-scenario',
          mint: mockTarget.mint,
        }),
      );
    });
  });

  describe('JSON output', () => {
    it('should write JSON file', async () => {
      const sink = new ConfigDrivenSink();
      const context = createContext({
        scenario: {
          ...mockScenario,
          outputs: [{ type: 'json', path: '/tmp/test.json' }],
        },
      });

      await sink.handle(context);

      expect(fs.mkdir).toHaveBeenCalledWith('/tmp', { recursive: true });
      expect(fs.appendFile).toHaveBeenCalledWith(
        '/tmp/test.json',
        expect.stringContaining('"scenario":"test-scenario"'),
        'utf-8',
      );
    });

    it('should include events when configured', async () => {
      const sink = new ConfigDrivenSink();
      const context = createContext({
        scenario: {
          ...mockScenario,
          outputs: [{ type: 'json', path: '/tmp/test.json', includeEvents: true }],
        },
      });

      await sink.handle(context);

      const appendCall = vi.mocked(fs.appendFile).mock.calls[0];
      const content = appendCall[1] as string;
      const parsed = JSON.parse(content);
      expect(parsed.result.events).toBeDefined();
      expect(parsed.result.events).toHaveLength(2);
    });

    it('should exclude events by default', async () => {
      const sink = new ConfigDrivenSink();
      const context = createContext({
        scenario: {
          ...mockScenario,
          outputs: [{ type: 'json', path: '/tmp/test.json' }],
        },
      });

      await sink.handle(context);

      const appendCall = vi.mocked(fs.appendFile).mock.calls[0];
      const content = appendCall[1] as string;
      const parsed = JSON.parse(content);
      expect(parsed.result.events).toBeUndefined();
      expect(parsed.result.finalPnl).toBeDefined();
    });
  });

  describe('CSV output', () => {
    it('should write CSV file with header', async () => {
      const sink = new ConfigDrivenSink();
      const context = createContext({
        scenario: {
          ...mockScenario,
          outputs: [{ type: 'csv', path: '/tmp/test.csv' }],
        },
      });

      await sink.handle(context);

      expect(fs.writeFile).toHaveBeenCalledWith(
        '/tmp/test.csv',
        expect.stringContaining('scenario,mint,token_symbol'),
        'utf-8',
      );
    });

    it('should append CSV rows when append is true', async () => {
      const sink = new ConfigDrivenSink();
      const context = createContext({
        scenario: {
          ...mockScenario,
          outputs: [{ type: 'csv', path: '/tmp/test.csv', append: true }],
        },
      });

      // First call to initialize
      await sink.handle(context);
      vi.clearAllMocks();

      // Second call should append
      await sink.handle(context);

      expect(fs.appendFile).toHaveBeenCalledWith(
        '/tmp/test.csv',
        expect.stringContaining('test-scenario'),
        'utf-8',
      );
    });

    it('should include token metadata in CSV', async () => {
      const sink = new ConfigDrivenSink();
      const context = createContext({
        scenario: {
          ...mockScenario,
          outputs: [{ type: 'csv', path: '/tmp/test.csv' }],
        },
      });

      await sink.handle(context);

      const appendCall = vi.mocked(fs.appendFile).mock.calls.find(
        (call) => call[0] === '/tmp/test.csv' && call[1]?.includes('TEST'),
      );
      expect(appendCall).toBeDefined();
    });
  });

  describe('ClickHouse output', () => {
    it('should write to simulation_events table with expanded schema', async () => {
      const { getClickHouseClient } = await import('../../src/storage/clickhouse-client');
      const mockClient = {
        insert: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(getClickHouseClient).mockReturnValue(mockClient as any);

      const sink = new ConfigDrivenSink();
      const context = createContext({
        scenario: {
          ...mockScenario,
          outputs: [{ type: 'clickhouse', schema: 'expanded' }],
        },
      });

      await sink.handle(context);

      expect(mockClient.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          table: expect.stringContaining('simulation_events'),
          values: expect.arrayContaining([
            expect.objectContaining({
              event_type: 'entry',
              token_address: mockTarget.mint,
            }),
          ]),
        }),
      );
    });

    it('should write to simulation_aggregates table with aggregate schema', async () => {
      const { getClickHouseClient } = await import('../../src/storage/clickhouse-client');
      const mockClient = {
        insert: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(getClickHouseClient).mockReturnValue(mockClient as any);

      const sink = new ConfigDrivenSink();
      const context = createContext({
        scenario: {
          ...mockScenario,
          outputs: [{ type: 'clickhouse', schema: 'aggregate' }],
        },
      });

      await sink.handle(context);

      expect(mockClient.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          table: expect.stringContaining('simulation_aggregates'),
          values: expect.arrayContaining([
            expect.objectContaining({
              final_pnl: 1.1,
              trade_count: 1,
            }),
          ]),
        }),
      );
    });

    it('should calculate reentry_count correctly', async () => {
      const { getClickHouseClient } = await import('../../src/storage/clickhouse-client');
      const mockClient = {
        insert: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(getClickHouseClient).mockReturnValue(mockClient as any);

      const sink = new ConfigDrivenSink();
      const context = createContext({
        result: {
          ...mockResult,
          events: [
            ...mockResult.events,
            {
              timestamp: 1500,
              type: 're_entry' as const,
              price: 1.05,
              remainingPosition: 1.0,
              pnlSoFar: 0.05,
            },
          ],
        },
        scenario: {
          ...mockScenario,
          outputs: [{ type: 'clickhouse', schema: 'aggregate' }],
        },
      });

      await sink.handle(context);

      const insertCall = vi.mocked(mockClient.insert).mock.calls[0];
      const values = insertCall[0].values as any[];
      expect(values[0].reentry_count).toBe(1);
    });
  });

  describe('error handling', () => {
    it('should log errors but continue with other outputs', async () => {
      const mockLogger = {
        error: vi.fn(),
      };

      const sink = new ConfigDrivenSink({
        defaultOutputs: [
          { type: 'json', path: '/invalid/path.json' },
          { type: 'stdout' },
        ],
        logger: mockLogger as any,
      });

      vi.mocked(fs.appendFile).mockRejectedValueOnce(new Error('Permission denied'));

      const context = createContext();

      await sink.handle(context);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to emit simulation result',
        expect.objectContaining({
          scenario: 'test-scenario',
          target: 'json',
        }),
      );

      // Should still write stdout
      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('path resolution', () => {
    it('should resolve relative paths from cwd', async () => {
      const sink = new ConfigDrivenSink();
      const context = createContext({
        scenario: {
          ...mockScenario,
          outputs: [{ type: 'json', path: 'data/test.json' }],
        },
      });

      await sink.handle(context);

      const mkdirCall = vi.mocked(fs.mkdir).mock.calls[0];
      expect(mkdirCall[0]).toContain('data');
    });

    it('should use absolute paths as-is', async () => {
      const sink = new ConfigDrivenSink();
      const context = createContext({
        scenario: {
          ...mockScenario,
          outputs: [{ type: 'json', path: '/absolute/path.json' }],
        },
      });

      await sink.handle(context);

      const mkdirCall = vi.mocked(fs.mkdir).mock.calls[0];
      expect(mkdirCall[0]).toBe('/absolute');
    });
  });
});

