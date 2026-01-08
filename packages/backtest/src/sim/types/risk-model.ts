/**
 * Risk Model Schema
 *
 * Defines risk constraints for simulations:
 * - Position limits
 * - Drawdown limits
 * - Exposure limits
 */

import { z } from 'zod';

/**
 * Position limits
 */
export const PositionLimitsSchema = z.object({
  /**
   * Maximum position size (USD)
   */
  maxPositionSize: z.number().positive().optional(),

  /**
   * Maximum position size as % of capital
   */
  maxPositionSizePercent: z.number().min(0).max(1).optional(),

  /**
   * Maximum number of concurrent positions
   */
  maxConcurrentPositions: z.number().int().positive().optional(),
});

export type PositionLimits = z.infer<typeof PositionLimitsSchema>;

/**
 * Drawdown limits
 */
export const DrawdownLimitsSchema = z.object({
  /**
   * Maximum drawdown (%)
   */
  maxDrawdownPercent: z.number().min(0).max(1).optional(),

  /**
   * Maximum drawdown (USD)
   */
  maxDrawdownUsd: z.number().positive().optional(),

  /**
   * Stop trading if drawdown exceeded
   */
  stopOnDrawdown: z.boolean().default(true),
});

export type DrawdownLimits = z.infer<typeof DrawdownLimitsSchema>;

/**
 * Exposure limits
 */
export const ExposureLimitsSchema = z.object({
  /**
   * Maximum total exposure (USD)
   */
  maxTotalExposure: z.number().positive().optional(),

  /**
   * Maximum exposure per asset (USD)
   */
  maxExposurePerAsset: z.number().positive().optional(),

  /**
   * Maximum exposure per asset as % of capital
   */
  maxExposurePerAssetPercent: z.number().min(0).max(1).optional(),
});

export type ExposureLimits = z.infer<typeof ExposureLimitsSchema>;

/**
 * Risk model configuration
 */
export const RiskModelSchema = z.object({
  /**
   * Position limits
   */
  positionLimits: PositionLimitsSchema.optional(),

  /**
   * Drawdown limits
   */
  drawdownLimits: DrawdownLimitsSchema.optional(),

  /**
   * Exposure limits
   */
  exposureLimits: ExposureLimitsSchema.optional(),
});

export type RiskModel = z.infer<typeof RiskModelSchema>;
