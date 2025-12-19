/**
 * Create WorkflowContext for DuckDB simulation
 *
 * Extends the base WorkflowContext with services for DuckDB operations,
 * simulation, and OHLCV ingestion.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  createProductionContext,
  type ProductionContextConfig,
} from './createProductionContext.js';
import type { RunSimulationDuckdbContext } from '../simulation/runSimulationDuckdb.js';
import type { WorkflowContext } from '../types.js';
import type { SimulationService, DuckDBStorageService } from '@quantbot/simulation';
import type { OhlcvIngestionService } from '@quantbot/ingestion';
import { createOhlcvIngestionContext } from './createOhlcvIngestionContext.js';

export interface DuckdbSimulationContextConfig extends ProductionContextConfig {
  /**
   * Optional simulation service (for testing)
   */
  simulationService?: SimulationService;
  /**
   * Optional DuckDB storage service (for testing)
   */
  duckdbStorageService?: DuckDBStorageService;
  /**
   * Optional OHLCV ingestion service (for testing)
   */
  ohlcvIngestionService?: OhlcvIngestionService;
}

/**
 * Create WorkflowContext for DuckDB simulation with services
 */
export function createDuckdbSimulationContext(
  config?: DuckdbSimulationContextConfig
): RunSimulationDuckdbContext {
  const baseContext: WorkflowContext = createProductionContext(config);

  // Get services from config or create defaults
  // Note: In production, these should be injected via CommandContext
  // This factory is mainly for testing
  const simulationService = config?.simulationService;
  const duckdbStorageService = config?.duckdbStorageService;
  const ohlcvIngestionService = config?.ohlcvIngestionService;

  if (!simulationService || !duckdbStorageService || !ohlcvIngestionService) {
    throw new Error(
      'createDuckdbSimulationContext requires all services to be provided. Use CommandContext in production.'
    );
  }

  // Get OHLCV ingestion context for workflow calls
  const ohlcvContext = createOhlcvIngestionContext();

  return {
    ...baseContext,
    services: {
      simulation: {
        async runSimulation(simConfig) {
          return simulationService.runSimulation(simConfig);
        },
      },
      duckdbStorage: {
        async queryCalls(path, limit) {
          return duckdbStorageService.queryCalls(path, limit);
        },
        async checkOhlcvAvailability(
          path,
          mint,
          alertTimestamp,
          intervalSeconds,
          requiredStart,
          requiredEnd
        ) {
          return duckdbStorageService.checkOhlcvAvailability(
            path,
            mint,
            alertTimestamp,
            intervalSeconds,
            requiredStart,
            requiredEnd
          );
        },
        async updateOhlcvMetadata(
          path,
          mint,
          alertTimestamp,
          intervalSeconds,
          timeRangeStart,
          timeRangeEnd,
          candleCount
        ) {
          return duckdbStorageService.updateOhlcvMetadata(
            path,
            mint,
            alertTimestamp,
            intervalSeconds,
            timeRangeStart,
            timeRangeEnd,
            candleCount
          );
        },
        async addOhlcvExclusion(path, mint, alertTimestamp, reason) {
          return duckdbStorageService.addOhlcvExclusion(path, mint, alertTimestamp, reason);
        },
      },
      ohlcvIngestion: {
        async ingestForCalls(params) {
          return ohlcvIngestionService.ingestForCalls(params);
        },
      },
    },
    ohlcvIngestion: ohlcvContext.jobs,
  };
}
