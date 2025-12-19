/**
 * ApiQuotaRepository - Postgres repository for API quota tracking
 *
 * @deprecated This repository is replaced by:
 * - DuckDB event log (@quantbot/observability/event-log) for billing-grade API call tracking
 * - Prometheus metrics (@quantbot/observability/prometheus-metrics) for live counters and alerting
 *
 * This will be removed in a future version.
 */

import { DateTime } from 'luxon';
import { getPostgresPool } from '../postgres-client';
import { logger } from '@quantbot/utils';

// QuotaStatus type - duplicated here to avoid circular dependency with @quantbot/observability
export interface QuotaStatus {
  service: string;
  limit: number;
  used: number;
  remaining: number;
  resetAt: Date;
  warningThreshold: number;
}

export interface ApiQuotaUsage {
  id: number;
  service: string;
  creditsUsed: number;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export class ApiQuotaRepository {
  /**
   * Record API usage
   */
  async recordUsage(
    service: string,
    credits: number,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const pool = getPostgresPool();
    const today = DateTime.utc().startOf('day').toJSDate();

    try {
      await pool.query(
        `INSERT INTO api_quota_usage (service, credits_used, timestamp, metadata_json)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (service, DATE_TRUNC('day', timestamp))
         DO UPDATE SET
           credits_used = api_quota_usage.credits_used + EXCLUDED.credits_used,
           metadata_json = COALESCE(EXCLUDED.metadata_json, api_quota_usage.metadata_json)`,
        [service, credits, today, metadata ? JSON.stringify(metadata) : null]
      );

      logger.debug('Recorded API usage', { service, credits });
    } catch (error) {
      logger.error('Failed to record API usage', error as Error, { service, credits });
      throw error;
    }
  }

  /**
   * Get usage for today
   */
  async getUsageToday(service: string): Promise<number> {
    const pool = getPostgresPool();
    const today = DateTime.utc().startOf('day').toJSDate();

    try {
      const result = await pool.query<{ credits_used: number }>(
        `SELECT COALESCE(SUM(credits_used), 0) as credits_used
         FROM api_quota_usage
         WHERE service = $1 AND DATE_TRUNC('day', timestamp) = DATE_TRUNC('day', $2::timestamp)`,
        [service, today]
      );

      return parseInt(result.rows[0]?.credits_used?.toString() || '0', 10);
    } catch (error) {
      logger.error('Failed to get usage today', error as Error, { service });
      return 0;
    }
  }

  /**
   * Get usage for this month
   */
  async getUsageThisMonth(service: string): Promise<number> {
    const pool = getPostgresPool();
    const monthStart = DateTime.utc().startOf('month').toJSDate();

    try {
      const result = await pool.query<{ credits_used: number }>(
        `SELECT COALESCE(SUM(credits_used), 0) as credits_used
         FROM api_quota_usage
         WHERE service = $1 AND timestamp >= $2`,
        [service, monthStart]
      );

      return parseInt(result.rows[0]?.credits_used?.toString() || '0', 10);
    } catch (error) {
      logger.error('Failed to get usage this month', error as Error, { service });
      return 0;
    }
  }

  /**
   * Get quota status for a service
   */
  async getQuotaStatus(
    service: string,
    limit: number,
    warningThreshold: number = 0.2
  ): Promise<QuotaStatus> {
    const used = await this.getUsageThisMonth(service);
    const resetAt = DateTime.utc().plus({ month: 1 }).startOf('month').toJSDate();

    return {
      service,
      limit,
      used,
      remaining: limit - used,
      resetAt,
      warningThreshold,
    };
  }

  /**
   * Get all quota usage records for a service in a time range
   */
  async getUsageHistory(service: string, from: Date, to: Date): Promise<ApiQuotaUsage[]> {
    const pool = getPostgresPool();

    try {
      const result = await pool.query<{
        id: number;
        service: string;
        credits_used: number;
        timestamp: Date;
        metadata_json: string | null;
      }>(
        `SELECT id, service, credits_used, timestamp, metadata_json
         FROM api_quota_usage
         WHERE service = $1 AND timestamp >= $2 AND timestamp <= $3
         ORDER BY timestamp DESC`,
        [service, from, to]
      );

      return result.rows.map((row) => ({
        id: row.id,
        service: row.service,
        creditsUsed: row.credits_used,
        timestamp: row.timestamp,
        metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
      }));
    } catch (error) {
      logger.error('Failed to get usage history', error as Error, { service });
      throw error;
    }
  }
}
