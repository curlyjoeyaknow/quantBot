/**
 * Sink Base Types
 * ===============
 * Base types for simulation result sinks.
 */

import type { SimulationRunContext, SimulationLogger } from '../core';

/**
 * Result sink interface
 */
export interface ResultSink {
  /** Sink name */
  readonly name: string;

  /**
   * Handle a simulation result
   */
  handle(context: SimulationRunContext): Promise<void>;

  /**
   * Flush any buffered data
   */
  flush?(): Promise<void>;

  /**
   * Close the sink
   */
  close?(): Promise<void>;
}

/**
 * Sink options base
 */
export interface BaseSinkOptions {
  /** Logger instance */
  logger?: SimulationLogger;
}
