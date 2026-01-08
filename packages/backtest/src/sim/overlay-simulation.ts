/**
 * Overlay Simulation Bridge
 *
 * Re-exports simulation's overlay-based simulation for use in backtest.
 * This provides type-safe access to overlay simulation without duplicating code.
 */

// Re-export everything from simulation's overlay-simulation
export {
  runOverlaySimulation,
  type ExitOverlay,
  type FeeModel,
  type PositionModel,
  type TradePoint,
  type PnlBreakdown,
  type SimulationDiagnostics,
  type OverlaySimulationResult,
  type OverlaySimulationRequest,
} from '@quantbot/simulation';
