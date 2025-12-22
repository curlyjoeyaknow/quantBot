/**
 * Create WorkflowContext for DuckDB simulation
 *
 * Extends the base WorkflowContext with services for DuckDB operations,
 * simulation, and OHLCV ingestion.
 */

import { ConfigurationError } from '@quantbot/utils';
import {
  createProductionContext,
  type ProductionContextConfig,
} from './createProductionContext.js';
import type { RunSimulationDuckdbContext } from '../simulation/runSimulationDuckdb.js';
import type { WorkflowContext } from '../types.js';
import type { SimulationService, DuckDBStorageService } from '@quantbot/simulation';
import type { OhlcvIngestionService } from '@quantbot/ingestion';
import { createOhlcvIngestionContext } from './createOhlcvIngestionContext.js';
// Dynamic import type for OhlcvFetchJob (jobs package)
// Using type assertion to bypass module resolution
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OhlcvFetchJob = any;

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
  /**
   * Optional OHLCV fetch job service (required for OHLCV ingestion)
   * OhlcvFetchJob handles both fetch AND store in parallel
   */
  ohlcvFetchJob?: OhlcvFetchJob;
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
    throw new ConfigurationError(
      'createDuckdbSimulationContext requires all services to be provided. Use CommandContext in production.',
      'services',
      {
        hasSimulationService: !!simulationService,
        hasDuckdbStorageService: !!duckdbStorageService,
        hasOhlcvIngestionService: !!ohlcvIngestionService,
      }
    );
  }

  // Get OHLCV ingestion context for workflow calls
  // Pass ohlcvFetchJob if available in config (for production use)
  const ohlcvContext = createOhlcvIngestionContext(
    config?.ohlcvFetchJob
      ? {
          ohlcvFetchJob: config.ohlcvFetchJob,
          duckdbStorage: duckdbStorageService,
        }
      : undefined
  );

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
          return await duckdbStorageService.queryCalls(path, limit);
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
          await duckdbStorageService.updateOhlcvMetadata(
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
          await duckdbStorageService.addOhlcvExclusion(path, mint, alertTimestamp, reason);
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
