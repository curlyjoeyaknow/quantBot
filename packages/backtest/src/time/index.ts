/**
 * Time and Clock Utilities
 *
 * Re-exports simulation's clock utilities for backtest usage.
 * Provides resolution-aware time handling for backtests.
 */

// Clock types and factory - imported from simulation's core subpath
// Note: These are available via @quantbot/simulation/core export
export {
  createClock,
  type ClockResolution,
  type SimulationClock,
  MillisecondClock,
  SecondClock,
  MinuteClock,
  HourClock,
} from '@quantbot/simulation/core';
