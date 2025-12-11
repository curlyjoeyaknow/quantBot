/**
 * Monitored Tokens Database Utilities
 * ====================================
 * Functions for storing and retrieving monitored tokens from Postgres
 * 
 * NOTE: This file will not compile in isolation because it depends on @quantbot/data
 * which hasn't been built yet. It will work when built as part of the monorepo.
 */

// TODO: These imports require @quantbot/data to be built first
// For now, using type-only imports to avoid compilation errors
import type { EntryConfig } from './types';
import { logger } from './logger';

// Placeholder types until storage package is available
type QueryResult = any;
type PostgresClient = any;

// TODO: Import these from @quantbot/data once available
const queryPostgres = async <T = any>(query: string, params?: any[]): Promise<QueryResult> => {
  throw new Error('queryPostgres not implemented - requires @quantbot/data');
};

const withPostgresTransaction = async <T>(callback: (client: PostgresClient) => Promise<T>): Promise<T> => {
  throw new Error('withPostgresTransaction not implemented - requires @quantbot/data');
};

export interface MonitoredToken {
  id?: number;
  tokenAddress: string;
  chain: string;
  tokenSymbol?: string;
  callerName: string;
  alertTimestamp: Date;
  alertPrice: number;
  entryConfig?: EntryConfig;
  status?: 'active' | 'paused' | 'completed' | 'removed';
  historicalCandlesCount?: number;
  lastPrice?: number;
  lastUpdateTime?: Date;
  entrySignalSent?: boolean;
  entryPrice?: number;
  entryTime?: Date;
  entryType?: 'initial' | 'trailing' | 'ichimoku';
}

/**
 * Store a monitored token in Postgres
 */
export async function storeMonitoredToken(token: MonitoredToken): Promise<number> {
  try {
    const result = await withPostgresTransaction(async (client) => {
      // First, ensure token exists in tokens table
      let tokenId: number | null = null;
      
      const tokenResult = await client.query(
        `INSERT INTO tokens (chain, address, symbol, name, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (chain, address) 
         DO UPDATE SET symbol = COALESCE(EXCLUDED.symbol, tokens.symbol),
                       name = COALESCE(EXCLUDED.name, tokens.name),
                       updated_at = NOW()
         RETURNING id`,
        [token.chain, token.tokenAddress, token.tokenSymbol || null, token.tokenSymbol || null]
      );

      if (tokenResult.rows.length > 0) {
        tokenId = tokenResult.rows[0].id;
      }

      // Ensure caller exists
      let callerId: number | null = null;
      const callerResult = await client.query(
        `INSERT INTO callers (source, handle, display_name, updated_at)
         VALUES ('telegram', $1, $1, NOW())
         ON CONFLICT (source, handle) 
         DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [token.callerName]
      );

      if (callerResult.rows.length > 0) {
        callerId = callerResult.rows[0].id;
      }

      // Insert or update monitored token
      const insertResult = await client.query(
        `INSERT INTO monitored_tokens (
          token_id, token_address, chain, token_symbol, caller_id, caller_name,
          alert_timestamp, alert_price, entry_config_json, status,
          historical_candles_count, last_price, last_update_time,
          entry_signal_sent, entry_price, entry_time, entry_type
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (token_address, chain, caller_name, alert_timestamp)
        DO UPDATE SET
          status = EXCLUDED.status,
          entry_config_json = EXCLUDED.entry_config_json,
          historical_candles_count = EXCLUDED.historical_candles_count,
          last_price = EXCLUDED.last_price,
          last_update_time = EXCLUDED.last_update_time,
          entry_signal_sent = EXCLUDED.entry_signal_sent,
          entry_price = EXCLUDED.entry_price,
          entry_time = EXCLUDED.entry_time,
          entry_type = EXCLUDED.entry_type,
          updated_at = NOW()
        RETURNING id`,
        [
          tokenId,
          token.tokenAddress,
          token.chain,
          token.tokenSymbol || null,
          callerId,
          token.callerName,
          token.alertTimestamp,
          token.alertPrice,
          token.entryConfig ? JSON.stringify(token.entryConfig) : null,
          token.status || 'active',
          token.historicalCandlesCount || 0,
          token.lastPrice || null,
          token.lastUpdateTime || null,
          token.entrySignalSent || false,
          token.entryPrice || null,
          token.entryTime || null,
          token.entryType || null,
        ]
      );

      return insertResult.rows[0].id;
    });

    logger.info('Stored monitored token in Postgres', {
      tokenAddress: token.tokenAddress.substring(0, 20),
      callerName: token.callerName,
      id: result,
    });

    return result;
  } catch (error) {
    logger.error('Failed to store monitored token', error as Error, {
      tokenAddress: token.tokenAddress.substring(0, 20),
    });
    throw error;
  }
}

/**
 * Get all active monitored tokens
 */
export async function getActiveMonitoredTokens(): Promise<MonitoredToken[]> {
  try {
    const result = await queryPostgres<{
      id: number;
      token_address: string;
      chain: string;
      token_symbol: string | null;
      caller_name: string;
      alert_timestamp: Date;
      alert_price: string;
      entry_config_json: string | null;
      status: string;
      historical_candles_count: number;
      last_price: string | null;
      last_update_time: Date | null;
      entry_signal_sent: boolean;
      entry_price: string | null;
      entry_time: Date | null;
      entry_type: string | null;
    }>(
      `SELECT 
        id, token_address, chain, token_symbol, caller_name,
        alert_timestamp, alert_price, entry_config_json, status,
        historical_candles_count, last_price, last_update_time,
        entry_signal_sent, entry_price, entry_time, entry_type
       FROM monitored_tokens
       WHERE status = 'active'
       ORDER BY created_at DESC`
    );

    return result.rows.map((row: any) => ({
      id: row.id,
      tokenAddress: row.token_address,
      chain: row.chain,
      tokenSymbol: row.token_symbol || undefined,
      callerName: row.caller_name,
      alertTimestamp: row.alert_timestamp,
      alertPrice: parseFloat(row.alert_price),
      entryConfig: row.entry_config_json ? JSON.parse(row.entry_config_json) : undefined,
      status: row.status as 'active' | 'paused' | 'completed' | 'removed',
      historicalCandlesCount: row.historical_candles_count,
      lastPrice: row.last_price ? parseFloat(row.last_price) : undefined,
      lastUpdateTime: row.last_update_time || undefined,
      entrySignalSent: row.entry_signal_sent,
      entryPrice: row.entry_price ? parseFloat(row.entry_price) : undefined,
      entryTime: row.entry_time || undefined,
      entryType: row.entry_type as 'initial' | 'trailing' | 'ichimoku' | undefined,
    }));
  } catch (error) {
    logger.error('Failed to get active monitored tokens', error as Error);
    return [];
  }
}

/**
 * Update monitored token status
 */
export async function updateMonitoredTokenStatus(
  id: number,
  status: 'active' | 'paused' | 'completed' | 'removed'
): Promise<void> {
  try {
    await queryPostgres(
      `UPDATE monitored_tokens 
       SET status = $1, updated_at = NOW()
       WHERE id = $2`,
      [status, id]
    );

    logger.info('Updated monitored token status', { id, status });
  } catch (error) {
    logger.error('Failed to update monitored token status', error as Error, { id });
    throw error;
  }
}

/**
 * Update monitored token entry information
 */
export async function updateMonitoredTokenEntry(
  id: number,
  entryPrice: number,
  entryTime: Date,
  entryType: 'initial' | 'trailing' | 'ichimoku',
  signalSent: boolean = true
): Promise<void> {
  try {
    await queryPostgres(
      `UPDATE monitored_tokens 
       SET entry_price = $1, entry_time = $2, entry_type = $3,
           entry_signal_sent = $4, updated_at = NOW()
       WHERE id = $5`,
      [entryPrice, entryTime, entryType, signalSent, id]
    );

    logger.info('Updated monitored token entry', { id, entryPrice, entryType });
  } catch (error) {
    logger.error('Failed to update monitored token entry', error as Error, { id });
    throw error;
  }
}





