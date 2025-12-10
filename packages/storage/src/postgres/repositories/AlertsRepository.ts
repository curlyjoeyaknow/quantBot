/**
 * AlertsRepository - Postgres repository for alerts
 * 
 * Handles all database operations for alerts table.
 */

import { DateTime } from 'luxon';
import { getPostgresPool, withPostgresTransaction } from '../../postgres-client';
import { logger } from '@quantbot/utils';
import type { Alert } from '@quantbot/utils/types/core';

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
          alert_price, alert_timestamp, raw_payload_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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

