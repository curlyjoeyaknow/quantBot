/**
 * Trading Configuration
 * 
 * Manages user trading settings and alert-to-trade rules
 */

import { queryPostgres } from '@quantbot/data';
import { logger } from '@quantbot/utils';
import type { TradingConfig, AlertTradeRules } from '../types';

export interface TradingConfigServiceOptions {
  // No options needed - uses queryPostgres directly
}

/**
 * Trading Configuration Service
 */
export class TradingConfigService {

  constructor(options?: TradingConfigServiceOptions) {
    // Uses queryPostgres directly
  }

  /**
   * Get trading configuration for a user
   */
  async getConfig(userId: number): Promise<TradingConfig | null> {
    try {
      const result = await queryPostgres(
        `SELECT * FROM user_trading_config WHERE user_id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return this.mapRowToConfig(row);
    } catch (error) {
      logger.error('Failed to get trading config', error as Error, { userId });
      throw error;
    }
  }

  /**
   * Create or update trading configuration
   */
  async upsertConfig(config: Partial<TradingConfig> & { userId: number }): Promise<TradingConfig> {
    try {
      const existing = await this.getConfig(config.userId);

      if (existing) {
        // Update existing config
        const updateFields: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;

        if (config.enabled !== undefined) {
          updateFields.push(`enabled = $${paramIndex++}`);
          values.push(config.enabled);
        }
        if (config.maxPositionSize !== undefined) {
          updateFields.push(`max_position_size = $${paramIndex++}`);
          values.push(config.maxPositionSize);
        }
        if (config.maxTotalExposure !== undefined) {
          updateFields.push(`max_total_exposure = $${paramIndex++}`);
          values.push(config.maxTotalExposure);
        }
        if (config.slippageTolerance !== undefined) {
          updateFields.push(`slippage_tolerance = $${paramIndex++}`);
          values.push(config.slippageTolerance);
        }
        if (config.dailyLossLimit !== undefined) {
          updateFields.push(`daily_loss_limit = $${paramIndex++}`);
          values.push(config.dailyLossLimit);
        }
        if (config.alertRules !== undefined) {
          updateFields.push(`alert_rules_json = $${paramIndex++}`);
          values.push(JSON.stringify(config.alertRules));
        }
        if (config.dryRun !== undefined) {
          updateFields.push(`dry_run = $${paramIndex++}`);
          values.push(config.dryRun);
        }

        updateFields.push(`updated_at = NOW()`);
        values.push(config.userId);

        const query = `
          UPDATE user_trading_config
          SET ${updateFields.join(', ')}
          WHERE user_id = $${paramIndex}
          RETURNING *
        `;

        const result = await queryPostgres(query, values);
        return this.mapRowToConfig(result.rows[0]);
      } else {
        // Create new config
        const defaultAlertRules: AlertTradeRules = {
          caDropAlerts: false,
          ichimokuSignals: false,
          liveTradeEntry: false,
        };

        const query = `
          INSERT INTO user_trading_config (
            user_id, enabled, max_position_size, max_total_exposure,
            slippage_tolerance, daily_loss_limit, alert_rules_json, dry_run
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `;

        const values = [
          config.userId,
          config.enabled ?? false,
          config.maxPositionSize ?? 1.0,
          config.maxTotalExposure ?? 10.0,
          config.slippageTolerance ?? 0.01,
          config.dailyLossLimit ?? 5.0,
          JSON.stringify(config.alertRules || defaultAlertRules),
          config.dryRun ?? true,
        ];

        const result = await queryPostgres(query, values);
        return this.mapRowToConfig(result.rows[0]);
      }
    } catch (error) {
      logger.error('Failed to upsert trading config', error as Error, { userId: config.userId });
      throw error;
    }
  }

  /**
   * Enable trading for a user
   */
  async enableTrading(userId: number): Promise<void> {
    await this.upsertConfig({ userId, enabled: true });
  }

  /**
   * Disable trading for a user
   */
  async disableTrading(userId: number): Promise<void> {
    await this.upsertConfig({ userId, enabled: false });
  }

  /**
   * Check if trading is enabled for a user
   */
  async isTradingEnabled(userId: number): Promise<boolean> {
    const config = await this.getConfig(userId);
    return config?.enabled ?? false;
  }

  /**
   * Map database row to TradingConfig
   */
  private mapRowToConfig(row: any): TradingConfig {
    return {
      userId: parseInt(row.user_id),
      enabled: row.enabled,
      maxPositionSize: parseFloat(row.max_position_size),
      maxTotalExposure: parseFloat(row.max_total_exposure),
      slippageTolerance: parseFloat(row.slippage_tolerance),
      dailyLossLimit: parseFloat(row.daily_loss_limit),
      alertRules: row.alert_rules_json || {},
      dryRun: row.dry_run,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

