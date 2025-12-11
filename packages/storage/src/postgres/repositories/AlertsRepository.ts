/**
 * AlertsRepository - Postgres repository for alerts
 * 
 * Handles all database operations for alerts table.
 */

import { DateTime } from 'luxon';
import { getPostgresPool, withPostgresTransaction } from '../../postgres-client';
import { logger } from '@quantbot/utils';
import type { Alert } from '@quantbot/core';

export interface AlertInsertData {
  tokenId: number;
  callerId?: number;
  strategyId?: number;
  side: 'buy' | 'sell';
  confidence?: number;
  alertPrice?: number;
  alertTimestamp: Date;
  rawPayload?: Record<string, unknown>;
  // Telegram-specific
  chatId?: string;
  messageId?: string;
  messageText?: string;
  // Caller alert metrics
  initialMcap?: number; // Market cap at alert time
  initialPrice?: number; // Price at alert time (for performance calculations)
  timeToATH?: number; // Seconds from alert to all-time high
  maxROI?: number; // Maximum ROI percentage
  athPrice?: number; // All-time high price
  athTimestamp?: Date; // Timestamp of all-time high
}

export class AlertsRepository {
  /**
   * Insert a new alert
   * Enforces idempotency by (chatId, messageId) if provided
   */
  async insertAlert(data: AlertInsertData): Promise<number> {
    return withPostgresTransaction(async (client) => {
      // Check for existing alert if chatId and messageId provided
      if (data.chatId && data.messageId) {
        const existing = await client.query<{ id: number }>(
          `SELECT id FROM alerts
           WHERE raw_payload_json->>'chatId' = $1
             AND raw_payload_json->>'messageId' = $2`,
          [data.chatId, data.messageId]
        );

        if (existing.rows.length > 0) {
          logger.debug('Alert already exists', { chatId: data.chatId, messageId: data.messageId });
          return existing.rows[0].id;
        }
      }

      // Build raw payload
      const rawPayload: Record<string, unknown> = {
        ...(data.rawPayload || {}),
        ...(data.chatId ? { chatId: data.chatId } : {}),
        ...(data.messageId ? { messageId: data.messageId } : {}),
        ...(data.messageText ? { messageText: data.messageText } : {}),
      };

      const result = await client.query<{ id: number }>(
        `INSERT INTO alerts (
          token_id, caller_id, strategy_id, side, confidence,
          alert_price, alert_timestamp, raw_payload_json,
          initial_mcap, initial_price, time_to_ath, max_roi, ath_price, ath_timestamp
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING id`,
        [
          data.tokenId,
          data.callerId || null,
          data.strategyId || null,
          data.side,
          data.confidence || null,
          data.alertPrice || null,
          data.alertTimestamp,
          JSON.stringify(rawPayload),
          data.initialMcap || null,
          data.initialPrice || null,
          data.timeToATH || null,
          data.maxROI || null,
          data.athPrice || null,
          data.athTimestamp || null,
        ]
      );

      const alertId = result.rows[0].id;
      logger.debug('Inserted alert', { alertId, tokenId: data.tokenId });
      return alertId;
    });
  }

  /**
   * Find alert by chat ID and message ID (Telegram)
   */
  async findByChatAndMessage(chatId: string, messageId: string): Promise<Alert | null> {
    const result = await getPostgresPool().query<{
      id: number;
      token_id: number;
      caller_id: number | null;
      strategy_id: number | null;
      side: string;
      confidence: number | null;
      alert_price: number | null;
      alert_timestamp: Date;
      raw_payload_json: Record<string, unknown> | null;
      created_at: Date;
    }>(
      `SELECT id, token_id, caller_id, strategy_id, side, confidence,
              alert_price, alert_timestamp, raw_payload_json, created_at
       FROM alerts
       WHERE raw_payload_json->>'chatId' = $1
         AND raw_payload_json->>'messageId' = $2`,
      [chatId, messageId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const payload = row.raw_payload_json || {};
    return {
      id: row.id,
      tokenId: row.token_id,
      callerId: row.caller_id || undefined,
      strategyId: row.strategy_id || undefined,
      side: row.side as 'buy' | 'sell',
      confidence: row.confidence || undefined,
      alertPrice: row.alert_price ? Number(row.alert_price) : undefined,
      alertTimestamp: DateTime.fromJSDate(row.alert_timestamp),
      rawPayload: payload,
      createdAt: DateTime.fromJSDate(row.created_at),
      chatId: payload.chatId as string | undefined,
      messageId: payload.messageId as string | undefined,
      messageText: payload.messageText as string | undefined,
    };
  }

  /**
   * Update alert metrics (time to ATH, max ROI, etc.)
   * CRITICAL: Preserves all existing data, only updates metrics
   */
  async updateAlertMetrics(
    alertId: number,
    metrics: {
      timeToATH?: number; // Seconds from alert to ATH
      maxROI?: number; // Maximum ROI percentage
      athPrice?: number; // All-time high price
      athTimestamp?: Date; // Timestamp of ATH
    }
  ): Promise<void> {
    const updates: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (metrics.timeToATH !== undefined) {
      updates.push(`time_to_ath = $${paramIndex}`);
      params.push(metrics.timeToATH);
      paramIndex++;
    }

    if (metrics.maxROI !== undefined) {
      updates.push(`max_roi = $${paramIndex}`);
      params.push(metrics.maxROI);
      paramIndex++;
    }

    if (metrics.athPrice !== undefined) {
      updates.push(`ath_price = $${paramIndex}`);
      params.push(metrics.athPrice);
      paramIndex++;
    }

    if (metrics.athTimestamp !== undefined) {
      updates.push(`ath_timestamp = $${paramIndex}`);
      params.push(metrics.athTimestamp);
      paramIndex++;
    }

    if (updates.length === 0) {
      return; // Nothing to update
    }

    params.push(alertId);
    const updateClause = updates.join(', ');

    await getPostgresPool().query(
      `UPDATE alerts
       SET ${updateClause}
       WHERE id = $${paramIndex}`,
      params
    );

    logger.debug('Updated alert metrics', { alertId, metrics });
  }

  /**
   * Find alerts by caller with metrics
   */
  async findByCaller(
    callerId: number,
    options?: { from?: Date; to?: Date; limit?: number }
  ): Promise<Alert[]> {
    const conditions: string[] = ['caller_id = $1'];
    const params: unknown[] = [callerId];
    let paramIndex = 2;

    if (options?.from) {
      conditions.push(`alert_timestamp >= $${paramIndex}`);
      params.push(options.from);
      paramIndex++;
    }

    if (options?.to) {
      conditions.push(`alert_timestamp <= $${paramIndex}`);
      params.push(options.to);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');
    const limitClause = options?.limit ? `LIMIT $${paramIndex}` : '';
    if (options?.limit) {
      params.push(options.limit);
    }

    const result = await getPostgresPool().query<{
      id: number;
      token_id: number;
      caller_id: number | null;
      strategy_id: number | null;
      side: string;
      confidence: number | null;
      alert_price: number | null;
      alert_timestamp: Date;
      initial_mcap: number | null;
      initial_price: number | null;
      time_to_ath: number | null;
      max_roi: number | null;
      ath_price: number | null;
      ath_timestamp: Date | null;
      raw_payload_json: Record<string, unknown> | null;
      created_at: Date;
    }>(
      `SELECT id, token_id, caller_id, strategy_id, side, confidence,
              alert_price, alert_timestamp, initial_mcap, initial_price, time_to_ath, max_roi,
              ath_price, ath_timestamp, raw_payload_json, created_at
       FROM alerts
       WHERE ${whereClause}
       ORDER BY alert_timestamp DESC
       ${limitClause}`,
      params
    );

    return result.rows.map((row) => {
      const payload = row.raw_payload_json || {};
      return {
        id: row.id,
        tokenId: row.token_id,
        callerId: row.caller_id || undefined,
        strategyId: row.strategy_id || undefined,
        side: row.side as 'buy' | 'sell',
        confidence: row.confidence || undefined,
        alertPrice: row.alert_price ? Number(row.alert_price) : undefined,
        alertTimestamp: DateTime.fromJSDate(row.alert_timestamp),
        rawPayload: payload,
        createdAt: DateTime.fromJSDate(row.created_at),
        chatId: payload.chatId as string | undefined,
        messageId: payload.messageId as string | undefined,
        messageText: payload.messageText as string | undefined,
        // Extended metrics (not in core Alert type, but available)
        initialMcap: row.initial_mcap ? Number(row.initial_mcap) : undefined,
        initialPrice: row.initial_price ? Number(row.initial_price) : undefined,
        timeToATH: row.time_to_ath || undefined,
        maxROI: row.max_roi ? Number(row.max_roi) : undefined,
        athPrice: row.ath_price ? Number(row.ath_price) : undefined,
        athTimestamp: row.ath_timestamp ? DateTime.fromJSDate(row.ath_timestamp) : undefined,
      } as Alert & {
        initialMcap?: number;
        initialPrice?: number;
        timeToATH?: number;
        maxROI?: number;
        athPrice?: number;
        athTimestamp?: DateTime;
      };
    });
  }

  /**
   * Find alerts by time range
   */
  async findByTimeRange(from: Date, to: Date): Promise<Alert[]> {
    const result = await getPostgresPool().query<{
      id: number;
      token_id: number;
      caller_id: number | null;
      strategy_id: number | null;
      side: string;
      confidence: number | null;
      alert_price: number | null;
      alert_timestamp: Date;
      raw_payload_json: Record<string, unknown> | null;
      created_at: Date;
    }>(
      `SELECT id, token_id, caller_id, strategy_id, side, confidence,
              alert_price, alert_timestamp, raw_payload_json, created_at
       FROM alerts
       WHERE alert_timestamp >= $1 AND alert_timestamp <= $2
       ORDER BY alert_timestamp ASC`,
      [from, to]
    );

    return result.rows.map((row) => {
      const payload = row.raw_payload_json || {};
      return {
        id: row.id,
        tokenId: row.token_id,
        callerId: row.caller_id || undefined,
        strategyId: row.strategy_id || undefined,
        side: row.side as 'buy' | 'sell',
        confidence: row.confidence || undefined,
        alertPrice: row.alert_price ? Number(row.alert_price) : undefined,
        alertTimestamp: DateTime.fromJSDate(row.alert_timestamp),
        rawPayload: payload,
        createdAt: DateTime.fromJSDate(row.created_at),
        chatId: payload.chatId as string | undefined,
        messageId: payload.messageId as string | undefined,
        messageText: payload.messageText as string | undefined,
      };
    });
  }
}

