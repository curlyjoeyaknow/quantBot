/**
 * TokenMetadataRepository - ClickHouse repository for token metadata snapshots
 *
 * Stores time-series snapshots of token metadata (market cap, price, volume, etc.)
 * separate from candles. This allows tracking metadata changes over time.
 *
 * CRITICAL: Always preserve full token address and exact case.
 */

import { DateTime } from 'luxon';
import { getClickHouseClient } from '../../clickhouse-client.js';
import { logger } from '@quantbot/utils';
import type { TokenMetadata } from '@quantbot/core';

export interface TokenMetadataSnapshot extends TokenMetadata {
  timestamp: number; // Unix timestamp in seconds
  tokenAddress: string; // Full mint address, case-preserved
  chain: string;
}

export class TokenMetadataRepository {
  /**
   * Ensure token_metadata table exists
   */
  async ensureTable(): Promise<void> {
    const ch = getClickHouseClient();
    const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

    await ch.exec({
      query: `
        CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.token_metadata (
          token_address String,
          chain String,
          timestamp DateTime,
          name String,
          symbol String,
          decimals Nullable(UInt8),
          price Nullable(Float64),
          market_cap Nullable(Float64),
          volume_24h Nullable(Float64),
          price_change_24h Nullable(Float64),
          logo_uri Nullable(String),
          socials_json String,
          creator Nullable(String),
          top_wallet_holdings Nullable(Float64),
          metadata_json String
        )
        ENGINE = MergeTree()
        PARTITION BY (chain, toYYYYMM(timestamp))
        ORDER BY (token_address, chain, timestamp)
        SETTINGS index_granularity = 8192
      `,
    });
  }

  /**
   * Upsert token metadata snapshot
   * CRITICAL: Preserves full address and exact case
   */
  async upsertMetadata(
    tokenAddress: string,
    chain: string,
    timestamp: number,
    metadata: TokenMetadata
  ): Promise<void> {
    await this.ensureTable();

    const ch = getClickHouseClient();
    const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

    const metadataObj = metadata as unknown as Record<string, unknown>;
    const socials = (metadataObj.socials as Record<string, unknown>) || {};
    const metadataExtras: Record<string, unknown> = {
      ...metadataObj,
      socials: undefined, // Remove from extras since we store separately
    };

    const row = {
      token_address: tokenAddress, // Full address, case-preserved
      chain: chain,
      timestamp: DateTime.fromSeconds(timestamp).toFormat('yyyy-MM-dd HH:mm:ss'),
      name: metadata.name || '',
      symbol: metadata.symbol || '',
      decimals: metadata.decimals || null,
      price: metadata.price || null,
      market_cap: metadata.marketCap || null,
      volume_24h: metadata.volume24h || null,
      price_change_24h: metadata.priceChange24h || null,
      logo_uri: metadata.logoURI || null,
      socials_json: JSON.stringify(socials),
      creator: (metadataObj.creator as string | undefined) || null,
      top_wallet_holdings: (metadataObj.topWalletHoldings as unknown) || null,
      metadata_json: JSON.stringify(metadataExtras),
    };

    try {
      await ch.insert({
        table: `${CLICKHOUSE_DATABASE}.token_metadata`,
        values: [row],
        format: 'JSONEachRow',
      });

      logger.debug('Upserted token metadata', {
        token: tokenAddress.substring(0, 20) + '...', // Display only
        chain,
        timestamp,
      });
    } catch (error: unknown) {
      logger.error('Error upserting token metadata', error as Error, {
        token: tokenAddress.substring(0, 20) + '...', // Display only
      });
      throw error;
    }
  }

  /**
   * Get latest metadata for a token
   * CRITICAL: Uses full address, case-preserved
   */
  async getLatestMetadata(
    tokenAddress: string,
    chain: string
  ): Promise<TokenMetadataSnapshot | null> {
    await this.ensureTable();

    const ch = getClickHouseClient();
    const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

    const escapedTokenAddress = tokenAddress.replace(/'/g, "''");

    try {
      const result = await ch.query({
        query: `
          SELECT 
            toUnixTimestamp(timestamp) as timestamp,
            token_address,
            chain,
            name,
            symbol,
            decimals,
            price,
            market_cap,
            volume_24h,
            price_change_24h,
            logo_uri,
            socials_json,
            creator,
            top_wallet_holdings,
            metadata_json
          FROM ${CLICKHOUSE_DATABASE}.token_metadata
          WHERE (token_address = '${escapedTokenAddress}' 
                 OR lower(token_address) = lower('${escapedTokenAddress}'))
            AND chain = '${chain.replace(/'/g, "''")}'
          ORDER BY timestamp DESC
          LIMIT 1
        `,
        format: 'JSONEachRow',
        clickhouse_settings: {
          max_execution_time: 30,
        },
      });

      const data = (await result.json()) as Array<{
        timestamp: number;
        token_address: string;
        chain: string;
        name: string;
        symbol: string;
        decimals: number | null;
        price: number | null;
        market_cap: number | null;
        volume_24h: number | null;
        price_change_24h: number | null;
        logo_uri: string | null;
        socials_json: string;
        creator: string | null;
        top_wallet_holdings: number | null;
        metadata_json: string;
      }>;

      if (!Array.isArray(data) || data.length === 0) {
        return null;
      }

      const row = data[0];
      const socials = JSON.parse(row.socials_json || '{}');
      const extras = JSON.parse(row.metadata_json || '{}');

      return {
        timestamp: row.timestamp,
        tokenAddress: row.token_address,
        chain: row.chain,
        name: row.name,
        symbol: row.symbol,
        decimals: row.decimals || undefined,
        price: row.price || undefined,
        marketCap: row.market_cap || undefined,
        volume24h: row.volume_24h || undefined,
        priceChange24h: row.price_change_24h || undefined,
        logoURI: row.logo_uri || undefined,
        socials: Object.keys(socials).length > 0 ? socials : undefined,
        creator: row.creator || undefined,
        topWalletHoldings: row.top_wallet_holdings || undefined,
        ...extras,
      };
    } catch (error: unknown) {
      logger.error('Error querying token metadata', error as Error, {
        token: tokenAddress.substring(0, 20) + '...', // Display only
      });
      return null;
    }
  }

  /**
   * Get metadata snapshots for a token in a time range
   * CRITICAL: Uses full address, case-preserved
   */
  async getMetadataHistory(
    tokenAddress: string,
    chain: string,
    startTime: DateTime,
    endTime: DateTime
  ): Promise<TokenMetadataSnapshot[]> {
    await this.ensureTable();

    const ch = getClickHouseClient();
    const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

    const startUnix = Math.floor(startTime.toSeconds());
    const endUnix = Math.floor(endTime.toSeconds());
    const escapedTokenAddress = tokenAddress.replace(/'/g, "''");

    try {
      const result = await ch.query({
        query: `
          SELECT 
            toUnixTimestamp(timestamp) as timestamp,
            token_address,
            chain,
            name,
            symbol,
            decimals,
            price,
            market_cap,
            volume_24h,
            price_change_24h,
            logo_uri,
            socials_json,
            creator,
            top_wallet_holdings,
            metadata_json
          FROM ${CLICKHOUSE_DATABASE}.token_metadata
          WHERE (token_address = '${escapedTokenAddress}' 
                 OR lower(token_address) = lower('${escapedTokenAddress}'))
            AND chain = '${chain.replace(/'/g, "''")}'
            AND timestamp >= toDateTime(${startUnix})
            AND timestamp <= toDateTime(${endUnix})
          ORDER BY timestamp ASC
        `,
        format: 'JSONEachRow',
        clickhouse_settings: {
          max_execution_time: 30,
        },
      });

      const data = (await result.json()) as Array<{
        timestamp: number;
        token_address: string;
        chain: string;
        name: string;
        symbol: string;
        decimals: number | null;
        price: number | null;
        market_cap: number | null;
        volume_24h: number | null;
        price_change_24h: number | null;
        logo_uri: string | null;
        socials_json: string;
        creator: string | null;
        top_wallet_holdings: number | null;
        metadata_json: string;
      }>;

      if (!Array.isArray(data)) {
        return [];
      }

      return data.map((row) => {
        const socials = JSON.parse(row.socials_json || '{}');
        const extras = JSON.parse(row.metadata_json || '{}');

        return {
          timestamp: row.timestamp,
          tokenAddress: row.token_address,
          chain: row.chain,
          name: row.name,
          symbol: row.symbol,
          decimals: row.decimals || undefined,
          price: row.price || undefined,
          marketCap: row.market_cap || undefined,
          volume24h: row.volume_24h || undefined,
          priceChange24h: row.price_change_24h || undefined,
          logoURI: row.logo_uri || undefined,
          socials: Object.keys(socials).length > 0 ? socials : undefined,
          creator: row.creator || undefined,
          topWalletHoldings: row.top_wallet_holdings || undefined,
          ...extras,
        };
      });
    } catch (error: unknown) {
      logger.error('Error querying token metadata history', error as Error, {
        token: tokenAddress.substring(0, 20) + '...', // Display only
      });
      return [];
    }
  }
}
