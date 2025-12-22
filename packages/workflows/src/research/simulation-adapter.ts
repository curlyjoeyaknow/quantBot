/**
 * Research OS - Simulation Adapter
 * =================================
 *
 * Adapts the existing simulation engine to the Research OS contract.
 * This bridges the gap between the new contract and existing implementation.
 */

import type {
  SimulationRequest,
  DataSnapshotRef,
  StrategyRef,
  ExecutionModel,
  CostModel,
  RiskModel,
  RunConfig,
} from './contract.js';
import type { RunArtifact, RunMetadata, TradeEvent, PnLSeries } from './artifacts.js';
import { calculateMetrics, calculatePnLSeries } from './metrics.js';
import { getGitSha, getGitBranch, hashValue } from './experiment-runner.js';
import type { ExperimentContext } from './experiment-runner.js';
import type { WorkflowContext } from '../types.js';
import type { Candle } from '../types.js';

/**
 * Adapter that converts Research OS contract to existing workflow system
 */
export class ResearchSimulationAdapter {
  constructor(private readonly workflowContext: WorkflowContext) {}

  /**
   * Run a simulation using the Research OS contract
   *
   * This adapts the contract to the existing simulation system.
   * In the future, this can be replaced with a native implementation.
   */
  async run(request: SimulationRequest): Promise<RunArtifact> {
    // TODO: This is a stub implementation
    // In the real implementation, we would:
    // 1. Load data from DataSnapshotRef
    // 2. Convert StrategyRef to strategy config
    // 3. Apply ExecutionModel, CostModel, RiskModel
    // 4. Run simulation with RunConfig
    // 5. Collect trade events, PnL series, etc.
    // 6. Calculate metrics
    // 7. Build RunArtifact

    // For now, return a minimal artifact structure
    // This will be implemented properly once we have:
    // - Data snapshot loading (from Branch B)
    // - Strategy conversion
    // - Execution/cost/risk model application

    const runId = this.workflowContext.ids.newRunId();
    const nowISO = this.workflowContext.clock.nowISO();

    // Build metadata
    const metadata: RunMetadata = {
      runId,
      gitSha: getGitSha(),
      gitBranch: getGitBranch(),
      createdAtISO: nowISO,
      dataSnapshotHash: request.dataSnapshot.contentHash,
      strategyConfigHash: request.strategy.configHash,
      executionModelHash: hashValue(request.executionModel),
      costModelHash: hashValue(request.costModel),
      riskModelHash: request.riskModel ? hashValue(request.riskModel) : undefined,
      runConfigHash: hashValue(request.runConfig),
      simulationTimeMs: 0, // TODO: Measure actual time
      schemaVersion: '1.0.0',
    };

    // For now, return empty artifact
    // This will be populated by actual simulation once integrated
    const tradeEvents: TradeEvent[] = [];
    const pnlSeries: PnLSeries[] = calculatePnLSeries(tradeEvents);
    const metrics = calculateMetrics(tradeEvents, pnlSeries);

    return {
      metadata,
      request,
      tradeEvents,
      pnlSeries,
      metrics,
    };
  }
}

/**
 * Create a simulation adapter from workflow context
 */
export function createSimulationAdapter(
  workflowContext: WorkflowContext
): ResearchSimulationAdapter {
  return new ResearchSimulationAdapter(workflowContext);
}
