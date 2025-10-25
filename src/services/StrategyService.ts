/**
 * Strategy Service
 * ================
 * Manages trading strategy operations including CRUD operations.
 * Wraps database operations with a clean service interface.
 */

import { Strategy, StopLossConfig } from '../simulate';
import * as db from '../utils/database';

export interface StrategyData {
  name: string;
  description?: string;
  strategy: Strategy[];
  stopLossConfig: StopLossConfig;
  isDefault?: boolean;
}

export interface SavedStrategy {
  id: number;
  name: string;
  description?: string;
  strategy: Strategy[];
  stopLossConfig: StopLossConfig;
  isDefault: boolean;
  createdAt: any; // DateTime
}

/**
 * Service for managing trading strategies
 */
export class StrategyService {
  /**
   * Save a new strategy or update an existing one
   */
  async saveStrategy(userId: number, strategyData: StrategyData): Promise<number> {
    return db.saveStrategy({
      userId,
      ...strategyData,
    });
  }

  /**
   * Get all strategies for a user
   */
  async getUserStrategies(userId: number): Promise<SavedStrategy[]> {
    return db.getUserStrategies(userId);
  }

  /**
   * Get a specific strategy by name for a user
   */
  async getStrategy(userId: number, name: string): Promise<SavedStrategy | null> {
    return db.getStrategy(userId, name);
  }

  /**
   * Delete a strategy
   */
  async deleteStrategy(userId: number, name: string): Promise<void> {
    return db.deleteStrategy(userId, name);
  }

  /**
   * Check if a strategy exists for a user
   */
  async strategyExists(userId: number, name: string): Promise<boolean> {
    const strategy = await this.getStrategy(userId, name);
    return strategy !== null;
  }

  /**
   * Get default strategy for a user
   */
  async getDefaultStrategy(userId: number): Promise<SavedStrategy | null> {
    const strategies = await this.getUserStrategies(userId);
    return strategies.find(s => s.isDefault) || null;
  }

  /**
   * Set a strategy as default
   */
  async setDefaultStrategy(userId: number, name: string): Promise<void> {
    // First, unset all defaults for this user
    const strategies = await this.getUserStrategies(userId);
    for (const strategy of strategies) {
      if (strategy.isDefault) {
        await this.saveStrategy(userId, {
          name: strategy.name,
          description: strategy.description,
          strategy: strategy.strategy,
          stopLossConfig: strategy.stopLossConfig,
          isDefault: false,
        });
      }
    }

    // Then set the new default
    const strategy = await this.getStrategy(userId, name);
    if (!strategy) {
      throw new Error(`Strategy "${name}" not found`);
    }

    await this.saveStrategy(userId, {
      name: strategy.name,
      description: strategy.description,
      strategy: strategy.strategy,
      stopLossConfig: strategy.stopLossConfig,
      isDefault: true,
    });
  }
}

// Export singleton instance
export const strategyService = new StrategyService();
