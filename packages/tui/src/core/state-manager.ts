/**
 * State Manager - Reactive state updates
 */

import type { StateSubscription } from '../types';

/**
 * State manager for reactive state updates
 */
export class StateManager<T = unknown> {
  private state: T;
  private subscriptions: Set<StateSubscription<T>> = new Set();

  constructor(initialState: T) {
    this.state = initialState;
  }

  /**
   * Get current state
   */
  getState(): T {
    return this.state;
  }

  /**
   * Update state
   */
  setState(updater: T | ((prev: T) => T)): void {
    const newState =
      typeof updater === 'function' ? (updater as (prev: T) => T)(this.state) : updater;

    if (newState !== this.state) {
      this.state = newState;
      this.notifySubscribers();
    }
  }

  /**
   * Subscribe to state changes
   */
  subscribe(callback: StateSubscription<T>): () => void {
    this.subscriptions.add(callback);

    // Return unsubscribe function
    return () => {
      this.subscriptions.delete(callback);
    };
  }

  /**
   * Notify all subscribers
   */
  private notifySubscribers(): void {
    for (const subscription of this.subscriptions) {
      try {
        subscription(this.state);
      } catch (error) {
        // Log error but don't break other subscriptions
        console.error('State subscription error:', error);
      }
    }
  }
}
