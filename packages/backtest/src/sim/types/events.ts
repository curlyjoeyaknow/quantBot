/**
 * Simulation Event Types
 * ======================
 * Event types for simulation lifecycle tracking.
 */

import type { EntryReason, ExitReason } from './position.js';

/**
 * Base simulation event
 */
export interface BaseSimulationEvent {
  /** Event type discriminator */
  type: string;
  /** Event timestamp (Unix seconds) */
  timestamp: number;
  /** Price at event time */
  price: number;
  /** Human-readable description */
  description: string;
}

/**
 * Entry event
 */
export interface EntryEvent extends BaseSimulationEvent {
  type: 'entry' | 'trailing_entry' | 'ladder_entry' | 're_entry';
  reason: EntryReason;
  size: number;
  remainingPosition: number;
  averageEntryPrice: number;
}

/**
 * Exit event
 */
export interface ExitEvent extends BaseSimulationEvent {
  type:
    | 'target_hit'
    | 'stop_loss'
    | 'trailing_stop'
    | 'signal_exit'
    | 'ladder_exit'
    | 'final_exit'
    | 'timeout_exit';
  reason: ExitReason;
  size: number;
  remainingPosition: number;
  pnlSoFar: number;
  pnlPercent: number;
}

/**
 * Stop modification event
 */
export interface StopModifiedEvent extends BaseSimulationEvent {
  type: 'stop_moved' | 'trailing_activated';
  oldStopLoss?: number;
  newStopLoss: number;
  remainingPosition: number;
}

/**
 * Signal event
 */
export interface SignalEvent extends BaseSimulationEvent {
  type: 'signal_triggered';
  signalType: 'entry' | 'exit';
  signalName?: string;
  indicators: Record<string, number | null>;
}

/**
 * Lifecycle event
 */
export interface LifecycleEvent extends BaseSimulationEvent {
  type: 'simulation_start' | 'simulation_end' | 'position_opened' | 'position_closed';
  metadata?: Record<string, unknown>;
}

/**
 * Union of all simulation events
 */
export type SimulationEvent =
  | EntryEvent
  | ExitEvent
  | StopModifiedEvent
  | SignalEvent
  | LifecycleEvent;

/**
 * Legacy event type for backwards compatibility
 */
export interface LegacySimulationEvent {
  type:
    | 'entry'
    | 'stop_moved'
    | 'target_hit'
    | 'stop_loss'
    | 'final_exit'
    | 'trailing_entry_triggered'
    | 're_entry'
    | 're_entry_rejected'
    | 'ladder_entry'
    | 'ladder_exit';
  timestamp: number;
  price: number;
  description: string;
  remainingPosition: number;
  pnlSoFar: number;
}

/**
 * Event handler type
 */
export type EventHandler<T extends SimulationEvent = SimulationEvent> = (event: T) => void;

/**
 * Event emitter interface
 */
export interface SimulationEventEmitter {
  emit<T extends SimulationEvent>(event: T): void;
  on<T extends SimulationEvent>(type: T['type'], handler: EventHandler<T>): void;
  off<T extends SimulationEvent>(type: T['type'], handler: EventHandler<T>): void;
  once<T extends SimulationEvent>(type: T['type'], handler: EventHandler<T>): void;
  getEvents(): SimulationEvent[];
  clear(): void;
}

/**
 * Convert new event to legacy format
 */
export function toLegacyEvent(event: SimulationEvent): LegacySimulationEvent {
  let pnlSoFar = 0;
  let remainingPosition = 1;

  if ('pnlSoFar' in event) {
    pnlSoFar = event.pnlSoFar;
  }
  if ('remainingPosition' in event) {
    remainingPosition = event.remainingPosition;
  }

  // Map new event types to legacy types
  let legacyType: LegacySimulationEvent['type'];
  switch (event.type) {
    case 'entry':
      legacyType = 'entry';
      break;
    case 'trailing_entry':
      legacyType = 'trailing_entry_triggered';
      break;
    case 'ladder_entry':
      legacyType = 'ladder_entry';
      break;
    case 're_entry':
      legacyType = 're_entry';
      break;
    case 'target_hit':
      legacyType = 'target_hit';
      break;
    case 'stop_loss':
    case 'trailing_stop':
      legacyType = 'stop_loss';
      break;
    case 'ladder_exit':
      legacyType = 'ladder_exit';
      break;
    case 'stop_moved':
    case 'trailing_activated':
      legacyType = 'stop_moved';
      break;
    case 'signal_exit':
    case 'final_exit':
    case 'timeout_exit':
    default:
      legacyType = 'final_exit';
      break;
  }

  return {
    type: legacyType,
    timestamp: event.timestamp,
    price: event.price,
    description: event.description,
    remainingPosition,
    pnlSoFar,
  };
}
