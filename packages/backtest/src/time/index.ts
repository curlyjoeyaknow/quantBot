/**
 * Time and Clock Utilities
 *
 * Re-exports simulation's clock utilities for backtest usage.
 * Provides resolution-aware time handling for backtests.
 */

// Clock types and factory - imported from local sim/core
export {
  createClock,
  type ClockResolution,
  type SimulationClock,
  MillisecondClock,
  SecondClock,
  MinuteClock,
  HourClock,
} from '../sim/core/clock.js';
