/**
 * Execution Reality Models
 * =======================
 * 
 * Branch C: Execution Reality Models
 * 
 * This module provides:
 * - Execution models (latency, slippage, failures, costs)
 * - Risk frameworks (circuit breakers, anomaly detection)
 * - Calibration tools (live data → model parameters)
 * 
 * All models are JSON-serializable and designed to be consumed by Branch A (simulation engine).
 */

// Types
export * from './types.js';
export type {
  LatencyDistribution,
  VenueLatencyConfig,
  SlippageModel,
  VenueSlippageConfig,
  FailureModel,
  PartialFillModel,
  ReorgModel,
  CostModel,
  ExecutionModel,
  CircuitBreakerConfig,
  AnomalyDetectionConfig,
  RiskFramework,
} from './types.js';

// Latency models
export {
  sampleLatency,
  sampleNetworkLatency,
  sampleConfirmationLatency,
  sampleTotalLatency,
  createPumpfunLatencyConfig,
  createPumpswapLatencyConfig,
} from './latency.js';

// Slippage models
export {
  calculateSlippage,
  calculateEntrySlippage,
  calculateExitSlippage,
  createPumpfunSlippageConfig,
  createPumpswapSlippageConfig,
} from './slippage.js';

// Failure models
export {
  sampleFailure,
  samplePartialFill,
  sampleReorg,
  createPumpfunFailureModel,
  createPumpfunPartialFillModel,
  createSolanaReorgModel,
} from './failures.js';

// Cost models
export {
  calculatePriorityFee,
  calculateComputeUnitCost,
  calculateTotalTransactionCost,
  calculateEffectiveCostPerTrade,
  createPumpfunCostModel,
  createPumpswapCostModel,
} from './costs.js';

// Risk framework
export {
  createCircuitBreakerState,
  checkCircuitBreaker,
  createAnomalyState,
  checkAnomalies,
  createDefaultRiskFramework,
  type CircuitBreakerState,
  type AnomalyState,
} from './risk.js';

// Execution model factory
export {
  createPumpfunExecutionModel,
  createPumpswapExecutionModel,
  createMinimalExecutionModel,
} from './models.js';

// Calibration
export {
  calibrateLatencyDistribution,
  calibrateSlippageModel,
  calibrateFailureModel,
  calibrateExecutionModel,
  type LiveTradeRecord,
  type CalibrationResult,
} from './calibration.js';
export { LiveTradeRecordSchema } from './calibration.js';

