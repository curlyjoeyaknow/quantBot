import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { DateTime } from 'luxon';
import {
  parseSimulationConfig,
  SimulationScenarioConfig,
  DefaultTargetResolver,
  simulateStrategy,
  Strategy,
} from '../src';
import { Candle } from '../src/candles';

describe('Simulation configuration parsing', () => {
  it('applies defaults and validates scenarios', () => {
    const raw = {
      version: '1',
      global: {
        defaults: {
          stopLoss: { initial: -0.4, trailing: 0.4 },
        },
      },
      scenarios: [
        {
          name: 'Simple',
          data: {
            kind: 'mint',
            mint: 'So11111111111111111111111111111111111111112',
            start: '2024-01-01T00:00:00Z',
            durationHours: 24,
          },
          strategy: [
            { target: 2, percent: 0.5 },
            { target: 3, percent: 0.5 },
          ],
        },
      ],
    };

    const config = parseSimulationConfig(raw);
    expect(config.scenarios).toHaveLength(1);
    expect(config.global.defaults.stopLoss?.initial).toBe(-0.4);
  });
});

describe('simulateStrategy', () => {
  const candles: Candle[] = [
    { timestamp: 0, open: 1, high: 1.1, low: 0.95, close: 1.05, volume: 100 },
    { timestamp: 60, open: 1.05, high: 2.2, low: 1.8, close: 2.0, volume: 100 },
    { timestamp: 120, open: 2.0, high: 2.5, low: 1.9, close: 2.4, volume: 100 },
  ];
  const strategy: Strategy[] = [
    { target: 2, percent: 0.5 },
    { target: 3, percent: 0.5 },
  ];

  it('realizes targets and exits remaining position', async () => {
    const result = await simulateStrategy(candles, strategy);
    expect(result.events.some((e) => e.type === 'target_hit')).toBe(true);
    expect(result.events.some((e) => e.type === 'final_exit')).toBe(true);
    expect(result.finalPnl).toBeGreaterThan(1);
  });
});

describe('DefaultTargetResolver', () => {
  it('creates targets from CSV files', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quantbot-sim-'));
    const csvPath = path.join(tmpDir, 'calls.csv');
    await fs.writeFile(
      csvPath,
      'mint,chain,timestamp\nMint1111111111111111111111111111111111111,solana,2024-01-01T00:00:00Z\n'
    );

    const scenario: SimulationScenarioConfig = {
      name: 'CSV scenario',
      tags: [],
      data: {
        kind: 'file',
        path: csvPath,
        format: 'csv',
        mintField: 'mint',
        chainField: 'chain',
        timestampField: 'timestamp',
        startOffsetMinutes: 0,
        durationHours: 12,
      },
      strategy: [{ target: 2, percent: 1 }],
      stopLoss: { initial: -0.5, trailing: 'none' },
    };

    const resolver = new DefaultTargetResolver();
    const targets = await resolver.resolve(scenario);
    expect(targets).toHaveLength(1);
    expect(targets[0].mint).toContain('Mint');
    expect(DateTime.isDateTime(targets[0].startTime)).toBe(true);
  });
});
