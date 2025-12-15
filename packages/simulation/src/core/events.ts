/**
 * Event Emitter
 * =============
 * Event system for simulation lifecycle tracking.
 */

import type { SimulationEvent, SimulationEventEmitter, EventHandler } from '../types';

/**
 * Simple event emitter implementation
 */
export class SimpleEventEmitter implements SimulationEventEmitter {
  private handlers = new Map<string, Set<EventHandler>>();
  private onceHandlers = new Map<string, Set<EventHandler>>();
  private events: SimulationEvent[] = [];

  emit<T extends SimulationEvent>(event: T): void {
    this.events.push(event);

    // Call regular handlers
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        handler(event);
      }
    }

    // Call and remove once handlers
    const onceHandlers = this.onceHandlers.get(event.type);
    if (onceHandlers) {
      for (const handler of onceHandlers) {
        handler(event);
      }
      this.onceHandlers.delete(event.type);
    }
  }

  on<T extends SimulationEvent>(type: T['type'], handler: EventHandler<T>): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler as EventHandler);
  }

  off<T extends SimulationEvent>(type: T['type'], handler: EventHandler<T>): void {
    const handlers = this.handlers.get(type);
    if (handlers) {
      handlers.delete(handler as EventHandler);
    }
  }

  once<T extends SimulationEvent>(type: T['type'], handler: EventHandler<T>): void {
    if (!this.onceHandlers.has(type)) {
      this.onceHandlers.set(type, new Set());
    }
    this.onceHandlers.get(type)!.add(handler as EventHandler);
  }

  getEvents(): SimulationEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}

/**
 * Create a new event emitter
 */
export function createEventEmitter(): SimulationEventEmitter {
  return new SimpleEventEmitter();
}
