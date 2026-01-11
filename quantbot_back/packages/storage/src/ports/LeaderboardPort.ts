import type { RunContext } from './CandleSlicePort.js';
import type { SimSummaryV1 } from './SimulationPort.js';

export interface LeaderboardPort {
  ingest(args: { run: RunContext; summary: SimSummaryV1 }): Promise<void>;
}
