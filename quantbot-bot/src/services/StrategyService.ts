/**
 * Strategy Service
 * ================
 * Manages trading strategy operations including CRUD operations.
 * Uses database client for persistence.
 */

import { Strategy } from '../simulation/engine';
import { StopLossConfig } from '../simulation/config';
import * as db from '../database/client';

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
  createdAt: any; // DateTime or string
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
      name: strategyData.name,
      description: strategyData.description,
      strategy: JSON.stringify(strategyData.strategy),
      stopLossConfig: JSON.stringify(strategyData.stopLossConfig),
      isDefault: strategyData.isDefault,
    });
  }

  /**
   * Get all strategies for a user
   */
  async getUserStrategies(userId: number): Promise<SavedStrategy[]> {
    const strategies = await db.getUserStrategies(userId);
    return strategies.map((s: any) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      strategy: typeof s.strategy === 'string' ? JSON.parse(s.strategy) : s.strategy,
      stopLossConfig: typeof s.stop_loss_config === 'string' ? JSON.parse(s.stop_loss_config) : s.stop_loss_config,
      isDefault: s.is_default === true || s.is_default === 1,
      createdAt: s.created_at,
    }));
  }

  /**
   * Get a specific strategy by ID
   */
  async getStrategy(id: number): Promise<SavedStrategy | null> {
    const strategy = await db.getStrategy(id);
    if (!strategy) return null;
    return {
      id: strategy.id,
      name: strategy.name,
      description: strategy.description,
      strategy: typeof strategy.strategy === 'string' ? JSON.parse(strategy.strategy) : strategy.strategy,
      stopLossConfig: typeof strategy.stop_loss_config === 'string' ? JSON.parse(strategy.stop_loss_config) : strategy.stop_loss_config,
      isDefault: strategy.is_default === true || strategy.is_default === 1,
      createdAt: strategy.created_at,
    };
  }

  /**
   * Delete a strategy
   */
  async deleteStrategy(id: number, userId: number): Promise<void> {
    return db.deleteStrategy(id, userId);
  }

  /**
   * Check if a strategy exists for a user
   */
  async strategyExists(userId: number, name: string): Promise<boolean> {
    const strategies = await this.getUserStrategies(userId);
    return strategies.some(s => s.name === name);
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
    const strategy = strategies.find(s => s.name === name);
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

