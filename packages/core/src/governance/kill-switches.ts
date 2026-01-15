/**
 * Kill switches for strategy governance
 * 
 * Provides emergency controls to pause/stop strategies when risk limits are breached.
 */

import { z } from 'zod';

/**
 * Kill switch state
 */
export const KillSwitchStateSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().optional(),
  triggeredAt: z.number().optional(),
  triggeredBy: z.string().optional(),
});

export type KillSwitchState = z.infer<typeof KillSwitchStateSchema>;

/**
 * Global kill switch - pauses all strategies
 */
export const GlobalKillSwitchSchema = z.object({
  type: z.literal('global'),
  state: KillSwitchStateSchema,
});

export type GlobalKillSwitch = z.infer<typeof GlobalKillSwitchSchema>;

/**
 * Per-strategy kill switch
 */
export const StrategyKillSwitchSchema = z.object({
  type: z.literal('strategy'),
  strategyId: z.string(),
  state: KillSwitchStateSchema,
});

export type StrategyKillSwitch = z.infer<typeof StrategyKillSwitchSchema>;

/**
 * Daily loss limit kill switch
 */
export const DailyLossLimitSchema = z.object({
  type: z.literal('daily_loss_limit'),
  maxDailyLossUsd: z.number().positive(),
  currentDailyLossUsd: z.number(),
  resetAt: z.number(), // Timestamp when daily loss resets
  state: KillSwitchStateSchema,
});

export type DailyLossLimit = z.infer<typeof DailyLossLimitSchema>;

/**
 * Drawdown kill switch
 */
export const DrawdownKillSwitchSchema = z.object({
  type: z.literal('drawdown'),
  maxDrawdownPercent: z.number().positive(),
  currentDrawdownPercent: z.number(),
  peakCapital: z.number(),
  currentCapital: z.number(),
  state: KillSwitchStateSchema,
});

export type DrawdownKillSwitch = z.infer<typeof DrawdownKillSwitchSchema>;

/**
 * Kill switch configuration
 */
export const KillSwitchConfigSchema = z.object({
  global: GlobalKillSwitchSchema,
  strategies: z.array(StrategyKillSwitchSchema),
  dailyLossLimit: DailyLossLimitSchema,
  drawdownLimit: DrawdownKillSwitchSchema,
});

export type KillSwitchConfig = z.infer<typeof KillSwitchConfigSchema>;

/**
 * Kill switch manager
 */
export class KillSwitchManager {
  private config: KillSwitchConfig;

  constructor(config: KillSwitchConfig) {
    this.config = config;
  }

  /**
   * Check if global kill switch is active
   */
  isGlobalKillSwitchActive(): boolean {
    return this.config.global.state.enabled;
  }

  /**
   * Check if strategy kill switch is active
   */
  isStrategyKillSwitchActive(strategyId: string): boolean {
    const strategySwitch = this.config.strategies.find(s => s.strategyId === strategyId);
    return strategySwitch?.state.enabled ?? false;
  }

  /**
   * Check if daily loss limit is breached
   */
  isDailyLossLimitBreached(): boolean {
    return this.config.dailyLossLimit.state.enabled;
  }

  /**
   * Check if drawdown limit is breached
   */
  isDrawdownLimitBreached(): boolean {
    return this.config.drawdownLimit.state.enabled;
  }

  /**
   * Check if strategy can execute (all kill switches)
   */
  canStrategyExecute(strategyId: string): { allowed: boolean; reason?: string } {
    if (this.isGlobalKillSwitchActive()) {
      return {
        allowed: false,
        reason: `Global kill switch active: ${this.config.global.state.reason ?? 'Manual override'}`,
      };
    }

    if (this.isStrategyKillSwitchActive(strategyId)) {
      const strategySwitch = this.config.strategies.find(s => s.strategyId === strategyId);
      return {
        allowed: false,
        reason: `Strategy kill switch active: ${strategySwitch?.state.reason ?? 'Manual override'}`,
      };
    }

    if (this.isDailyLossLimitBreached()) {
      return {
        allowed: false,
        reason: `Daily loss limit breached: $${this.config.dailyLossLimit.currentDailyLossUsd.toFixed(2)} / $${this.config.dailyLossLimit.maxDailyLossUsd.toFixed(2)}`,
      };
    }

    if (this.isDrawdownLimitBreached()) {
      return {
        allowed: false,
        reason: `Drawdown limit breached: ${this.config.drawdownLimit.currentDrawdownPercent.toFixed(2)}% / ${this.config.drawdownLimit.maxDrawdownPercent.toFixed(2)}%`,
      };
    }

    return { allowed: true };
  }

  /**
   * Activate global kill switch
   */
  activateGlobalKillSwitch(reason: string, triggeredBy: string): void {
    this.config.global.state = {
      enabled: true,
      reason,
      triggeredAt: Date.now(),
      triggeredBy,
    };
  }

  /**
   * Deactivate global kill switch
   */
  deactivateGlobalKillSwitch(): void {
    this.config.global.state = {
      enabled: false,
    };
  }

  /**
   * Activate strategy kill switch
   */
  activateStrategyKillSwitch(strategyId: string, reason: string, triggeredBy: string): void {
    const existing = this.config.strategies.find(s => s.strategyId === strategyId);
    if (existing) {
      existing.state = {
        enabled: true,
        reason,
        triggeredAt: Date.now(),
        triggeredBy,
      };
    } else {
      this.config.strategies.push({
        type: 'strategy',
        strategyId,
        state: {
          enabled: true,
          reason,
          triggeredAt: Date.now(),
          triggeredBy,
        },
      });
    }
  }

  /**
   * Deactivate strategy kill switch
   */
  deactivateStrategyKillSwitch(strategyId: string): void {
    const existing = this.config.strategies.find(s => s.strategyId === strategyId);
    if (existing) {
      existing.state = {
        enabled: false,
      };
    }
  }

  /**
   * Update daily loss
   */
  updateDailyLoss(lossUsd: number): void {
    this.config.dailyLossLimit.currentDailyLossUsd += lossUsd;

    // Check if limit breached
    if (this.config.dailyLossLimit.currentDailyLossUsd >= this.config.dailyLossLimit.maxDailyLossUsd) {
      this.config.dailyLossLimit.state = {
        enabled: true,
        reason: 'Daily loss limit breached',
        triggeredAt: Date.now(),
        triggeredBy: 'system',
      };
    }
  }

  /**
   * Reset daily loss (called at start of new day)
   */
  resetDailyLoss(): void {
    this.config.dailyLossLimit.currentDailyLossUsd = 0;
    this.config.dailyLossLimit.resetAt = Date.now() + 86400000; // Next day
    this.config.dailyLossLimit.state = {
      enabled: false,
    };
  }

  /**
   * Update drawdown
   */
  updateDrawdown(currentCapital: number): void {
    // Update peak if current capital is higher
    if (currentCapital > this.config.drawdownLimit.peakCapital) {
      this.config.drawdownLimit.peakCapital = currentCapital;
    }

    this.config.drawdownLimit.currentCapital = currentCapital;

    // Calculate drawdown
    const drawdown = this.config.drawdownLimit.peakCapital - currentCapital;
    const drawdownPercent = (drawdown / this.config.drawdownLimit.peakCapital) * 100;
    this.config.drawdownLimit.currentDrawdownPercent = drawdownPercent;

    // Check if limit breached
    if (drawdownPercent >= this.config.drawdownLimit.maxDrawdownPercent) {
      this.config.drawdownLimit.state = {
        enabled: true,
        reason: 'Drawdown limit breached',
        triggeredAt: Date.now(),
        triggeredBy: 'system',
      };
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): KillSwitchConfig {
    return this.config;
  }
}

