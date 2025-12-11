/**
 * CallsRepository - Postgres repository for calls (normalized trading signals)
 * 
 * Handles all database operations for calls table.
 */

import { DateTime } from 'luxon';
import { getPostgresPool } from '../../postgres-client';
import { logger } from '@quantbot/utils';
import type { Call, CallSelection } from '@quantbot/core';

export interface CallInsertData {
  alertId?: number;
  tokenId: number;
  callerId?: number;
  strategyId?: number;
  side: 'buy' | 'sell';
  signalType: 'entry' | 'exit' | 'scale_in' | 'scale_out';
  signalStrength?: number;
  signalTimestamp: Date;
  metadata?: Record<string, unknown>;
}

export class CallsRepository {
  /**
   * Insert a new call
   */
  async insertCall(data: CallInsertData): Promise<number> {
    const result = await getPostgresPool().query<{ id: number }>(
      `INSERT INTO calls (
        alert_id, token_id, caller_id, strategy_id, side,
        signal_type, signal_strength, signal_timestamp, metadata_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id`,
      [
        data.alertId || null,
        data.tokenId,
        data.callerId || null,
        data.strategyId || null,
        data.side,
        data.signalType,
        data.signalStrength || null,
        data.signalTimestamp,
        data.metadata ? JSON.stringify(data.metadata) : null,
      ]
    );

    const callId = result.rows[0].id;
    logger.debug('Inserted call', { callId, tokenId: data.tokenId });
    return callId;
  }

  /**
   * Query calls by selection criteria
   */
  async queryBySelection(selection: CallSelection): Promise<Call[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (selection.callerIds && selection.callerIds.length > 0) {
      conditions.push(`caller_id = ANY($${paramIndex}::bigint[])`);
      params.push(selection.callerIds);
      paramIndex++;
    }

    if (selection.callerNames && selection.callerNames.length > 0) {
      // Need to join with callers table
      conditions.push(`caller_id IN (
        SELECT id FROM callers
        WHERE (source || '/' || handle) = ANY($${paramIndex}::text[])
      )`);
      params.push(selection.callerNames);
      paramIndex++;
    }

    if (selection.tokenAddresses && selection.tokenAddresses.length > 0) {
      // Need to join with tokens table
      conditions.push(`token_id IN (
        SELECT id FROM tokens
        WHERE address = ANY($${paramIndex}::text[])
      )`);
      params.push(selection.tokenAddresses);
      paramIndex++;
    }

    if (selection.from) {
      conditions.push(`signal_timestamp >= $${paramIndex}`);
      params.push(selection.from);
      paramIndex++;
    }

    if (selection.to) {
      conditions.push(`signal_timestamp <= $${paramIndex}`);
      params.push(selection.to);
      paramIndex++;
    }

    if (selection.side) {
      conditions.push(`side = $${paramIndex}`);
      params.push(selection.side);
      paramIndex++;
    }

    if (selection.signalTypes && selection.signalTypes.length > 0) {
      conditions.push(`signal_type = ANY($${paramIndex}::text[])`);
      params.push(selection.signalTypes);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT id, alert_id, token_id, caller_id, strategy_id, side,
             signal_type, signal_strength, signal_timestamp, metadata_json, created_at
      FROM calls
      ${whereClause}
      ORDER BY signal_timestamp ASC
    `;

    const result = await getPostgresPool().query<{
      id: number;
      alert_id: number | null;
      token_id: number;
      caller_id: number | null;
      strategy_id: number | null;
      side: string;
      signal_type: string;
      signal_strength: number | null;
      signal_timestamp: Date;
      metadata_json: Record<string, unknown> | null;
      created_at: Date;
    }>(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      alertId: row.alert_id || undefined,
      tokenId: row.token_id,
      callerId: row.caller_id || undefined,
      strategyId: row.strategy_id || undefined,
      side: row.side as 'buy' | 'sell',
      signalType: row.signal_type as 'entry' | 'exit' | 'scale_in' | 'scale_out',
      signalStrength: row.signal_strength || undefined,
      signalTimestamp: DateTime.fromJSDate(row.signal_timestamp),
      metadata: row.metadata_json || undefined,
      createdAt: DateTime.fromJSDate(row.created_at),
    }));
  }

  /**
   * Find calls by token address
   */
  async findByToken(tokenAddress: string): Promise<Call[]> {
    const result = await getPostgresPool().query<{
      id: number;
      alert_id: number | null;
      token_id: number;
      caller_id: number | null;
      strategy_id: number | null;
      side: string;
      signal_type: string;
      signal_strength: number | null;
      signal_timestamp: Date;
      metadata_json: Record<string, unknown> | null;
      created_at: Date;
    }>(
      `SELECT c.id, c.alert_id, c.token_id, c.caller_id, c.strategy_id, c.side,
              c.signal_type, c.signal_strength, c.signal_timestamp, c.metadata_json, c.created_at
       FROM calls c
       JOIN tokens t ON c.token_id = t.id
       WHERE t.address = $1
       ORDER BY c.signal_timestamp ASC`,
      [tokenAddress] // Full address, case-preserved
    );

    return result.rows.map((row) => ({
      id: row.id,
      alertId: row.alert_id || undefined,
      tokenId: row.token_id,
      callerId: row.caller_id || undefined,
      strategyId: row.strategy_id || undefined,
      side: row.side as 'buy' | 'sell',
      signalType: row.signal_type as 'entry' | 'exit' | 'scale_in' | 'scale_out',
      signalStrength: row.signal_strength || undefined,
      signalTimestamp: DateTime.fromJSDate(row.signal_timestamp),
      metadata: row.metadata_json || undefined,
      createdAt: DateTime.fromJSDate(row.created_at),
    }));
  }
}

