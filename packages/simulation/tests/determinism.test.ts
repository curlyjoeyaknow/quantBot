import { describe, it } from 'vitest';
import { createHash } from 'crypto';
// Import directly from backtest source to avoid Vitest SSR module resolution issues
import { simulateStrategy } from '../../backtest/src/sim/core/simulator.js';
import type { Candle } from '../../backtest/src/sim/types/candle.js';
import type {
  EntryConfig,
  ReEntryConfig,
  StopLossConfig,
  StrategyLeg,
  CostConfig,
  LegacySimulationEvent,
  SimulationResult,
} from '../src/types';

type SimulationSnapshot = {
  finalPnl: number;
  tradeCount: number;
  eventTrace: Array<{
    type: LegacySimulationEvent['type'];
    timestamp: number;
    price: number;
    remainingPosition: number;
    pnlSoFar: number;
  }>;
};

type SnapshotDigest = {
  hash: string;
  payload: SimulationSnapshot;
};

const FIXTURE_STRATEGY: StrategyLeg[] = [{ target: 1.02, percent: 1 }];
const FIXTURE_STOP_LOSS: StopLossConfig = { initial: -0.05, trailing: 'none' };
const FIXTURE_ENTRY: EntryConfig = { initialEntry: 'none', trailingEntry: 'none', maxWaitTime: 60 };
const FIXTURE_REENTRY: ReEntryConfig = { trailingReEntry: 'none', maxReEntries: 0 };
const FIXTURE_COSTS: CostConfig = { entrySlippageBps: 0, exitSlippageBps: 0, takerFeeBps: 0 };

const FIXTURE_INTERVAL_SECONDS = 60;
const FIXTURE_START_TIMESTAMP = 1_700_000_000;
const FIXTURE_CANDLE_COUNT = 24;

function createFixtureCandles(seed: number): Candle[] {
  let rng = seed >>> 0;
  const next = () => {
    rng = (1664525 * rng + 1013904223) >>> 0;
    return rng / 0xffffffff;
  };

  const candles: Candle[] = [];
  let price = 1;

  for (let i = 0; i < FIXTURE_CANDLE_COUNT; i += 1) {
    const timestamp = FIXTURE_START_TIMESTAMP + i * FIXTURE_INTERVAL_SECONDS;
    const drift = (next() - 0.5) * 0.04;
    const open = price;
    const close = Math.max(0.5, open + drift);
    const high = Math.max(open, close) + Math.abs(drift) * 0.8;
    const low = Math.min(open, close) - Math.abs(drift) * 0.6;
    const volume = 1000 + next() * 250;

    candles.push({ timestamp, open, high, low, close, volume });
    price = close;
  }

  return candles;
}

function buildSnapshot(result: SimulationResult): SnapshotDigest {
  const tradeCount = result.events.length;
  const eventTrace = result.events.map((event) => ({
    type: event.type,
    timestamp: event.timestamp,
    price: event.price,
    remainingPosition: event.remainingPosition,
    pnlSoFar: event.pnlSoFar,
  }));
  const payload: SimulationSnapshot = {
    finalPnl: result.finalPnl,
    tradeCount,
    eventTrace,
  };

  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');

  return { hash, payload };
}

function assertSnapshotsEqual(label: string, left: SnapshotDigest, right: SnapshotDigest) {
  if (left.hash !== right.hash) {
    throw new Error(
      [
        `${label} mismatch: expected identical outputs for the same seed.`,
        `Left hash:  ${left.hash}`,
        `Right hash: ${right.hash}`,
        'Left payload:',
        JSON.stringify(left.payload, null, 2),
        'Right payload:',
        JSON.stringify(right.payload, null, 2),
      ].join('\n')
    );
  }
}

function assertSnapshotsDiffer(label: string, left: SnapshotDigest, right: SnapshotDigest) {
  if (left.hash === right.hash) {
    throw new Error(
      [
        `${label} mismatch: expected outputs to differ for different seeds.`,
        `Hash: ${left.hash}`,
        'Payload (shared):',
        JSON.stringify(left.payload, null, 2),
      ].join('\n')
    );
  }
}

async function runSeededSimulation(seed: number): Promise<SnapshotDigest> {
  const candles = createFixtureCandles(seed);
  const result = await simulateStrategy(
    candles,
    FIXTURE_STRATEGY,
    FIXTURE_STOP_LOSS,
    FIXTURE_ENTRY,
    FIXTURE_REENTRY,
    FIXTURE_COSTS
  );

  return buildSnapshot(result);
}

describe('Simulation determinism', () => {
  it('produces identical hashes for the same seed and different hashes for a different seed', async () => {
    const firstRun = await runSeededSimulation(1337);
    const secondRun = await runSeededSimulation(1337);
    const thirdRun = await runSeededSimulation(4242);

    assertSnapshotsEqual('Determinism check', firstRun, secondRun);
    assertSnapshotsDiffer('Seed divergence check', firstRun, thirdRun);
  });
});
