/**
 * TokenDataRepository - Postgres repository for token_data table
 *
 * Handles all database operations for dynamic token metrics.
 * This table stores time-series data that changes over time (price, mcap, volume, etc.)
 */

import { DateTime } from 'luxon';
import { getPostgresPool, withPostgresTransaction } from '../postgres-client';
import { logger } from '@quantbot/utils';

export interface TokenDataInsertData {
  tokenId: number;
  price?: number;
  marketCap?: number;
  liquidity?: number;
  liquidityMultiplier?: number; // MC/Liq ratio
  volume?: number;
  volume1h?: number;
  buyers1h?: number;
  sellers1h?: number;
  priceChange1h?: number;
  topHoldersPercent?: number; // Sum of all top holder percentages
  totalHolders?: number;
  supply?: number;
  athMcap?: number;
  tokenAge?: string;
  avgHolderAge?: string;
  freshWallets1d?: number;
  freshWallets7d?: number;
  exchange?: string;
  platform?: string;
  twitterLink?: string;
  telegramLink?: string;
  websiteLink?: string;
  recordedAt: Date; // When this data snapshot was recorded
}

export interface TokenDataRecord {
  id: number;
  tokenId: number;
  price?: number;
  marketCap?: number;
  liquidity?: number;
  liquidityMultiplier?: number;
  volume?: number;
  volume1h?: number;
  buyers1h?: number;
  sellers1h?: number;
  priceChange1h?: number;
  topHoldersPercent?: number;
  totalHolders?: number;
  supply?: number;
  athMcap?: number;
  tokenAge?: string;
  avgHolderAge?: string;
  freshWallets1d?: number;
  freshWallets7d?: number;
  exchange?: string;
  platform?: string;
  twitterLink?: string;
  telegramLink?: string;
  websiteLink?: string;
  recordedAt: DateTime;
  createdAt: DateTime;
}

export class TokenDataRepository {
  /**
   * Insert or update token data snapshot
   * Uses ON CONFLICT to update if record exists for same token_id and recorded_at
   */
  async upsertTokenData(data: TokenDataInsertData): Promise<number> {
    return withPostgresTransaction(async (client: any) => {
      const result = await client.query(
        `INSERT INTO token_data (
          token_id, price, market_cap, liquidity, liquidity_multiplier,
          volume, volume_1h, buyers_1h, sellers_1h, price_change_1h,
          top_holders_percent, total_holders, supply, ath_mcap,
          token_age, avg_holder_age, fresh_wallets_1d, fresh_wallets_7d,
          exchange, platform, twitter_link, telegram_link, website_link,
          recorded_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
        ON CONFLICT (token_id, recorded_at)
        DO UPDATE SET
          price = EXCLUDED.price,
          market_cap = EXCLUDED.market_cap,
          liquidity = EXCLUDED.liquidity,
          liquidity_multiplier = EXCLUDED.liquidity_multiplier,
          volume = EXCLUDED.volume,
          volume_1h = EXCLUDED.volume_1h,
          buyers_1h = EXCLUDED.buyers_1h,
          sellers_1h = EXCLUDED.sellers_1h,
          price_change_1h = EXCLUDED.price_change_1h,
          top_holders_percent = EXCLUDED.top_holders_percent,
          total_holders = EXCLUDED.total_holders,
          supply = EXCLUDED.supply,
          ath_mcap = EXCLUDED.ath_mcap,
          token_age = EXCLUDED.token_age,
          avg_holder_age = EXCLUDED.avg_holder_age,
          fresh_wallets_1d = EXCLUDED.fresh_wallets_1d,
          fresh_wallets_7d = EXCLUDED.fresh_wallets_7d,
          exchange = EXCLUDED.exchange,
          platform = EXCLUDED.platform,
          twitter_link = EXCLUDED.twitter_link,
          telegram_link = EXCLUDED.telegram_link,
          website_link = EXCLUDED.website_link
        RETURNING id`,
        [
          data.tokenId,
          data.price || null,
          data.marketCap || null,
          data.liquidity || null,
          data.liquidityMultiplier || null,
          data.volume || null,
          data.volume1h || null,
          data.buyers1h || null,
          data.sellers1h || null,
          data.priceChange1h || null,
          data.topHoldersPercent || null,
          data.totalHolders || null,
          data.supply || null,
          data.athMcap || null,
          data.tokenAge || null,
          data.avgHolderAge || null,
          data.freshWallets1d || null,
          data.freshWallets7d || null,
          data.exchange || null,
          data.platform || null,
          data.twitterLink || null,
          data.telegramLink || null,
          data.websiteLink || null,
          data.recordedAt,
        ]
      );

      const tokenDataId = result.rows[0].id;
      logger.debug('Upserted token data', { tokenDataId, tokenId: data.tokenId });
      return tokenDataId;
    });
  }

  /**
   * Get latest token data for a token
   */
  async getLatestTokenData(tokenId: number): Promise<TokenDataRecord | null> {
    const result = await getPostgresPool().query<{
      id: number;
      token_id: number;
      price: number | null;
      market_cap: number | null;
      liquidity: number | null;
      liquidity_multiplier: number | null;
      volume: number | null;
      volume_1h: number | null;
      buyers_1h: number | null;
      sellers_1h: number | null;
      price_change_1h: number | null;
      top_holders_percent: number | null;
      total_holders: number | null;
      supply: number | null;
      ath_mcap: number | null;
      token_age: string | null;
      avg_holder_age: string | null;
      fresh_wallets_1d: number | null;
      fresh_wallets_7d: number | null;
      exchange: string | null;
      platform: string | null;
      twitter_link: string | null;
      telegram_link: string | null;
      website_link: string | null;
      recorded_at: Date;
      created_at: Date;
    }>(
      `SELECT * FROM token_data
       WHERE token_id = $1
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [tokenId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      tokenId: row.token_id,
      price: row.price ? Number(row.price) : undefined,
      marketCap: row.market_cap ? Number(row.market_cap) : undefined,
      liquidity: row.liquidity ? Number(row.liquidity) : undefined,
      liquidityMultiplier: row.liquidity_multiplier ? Number(row.liquidity_multiplier) : undefined,
      volume: row.volume ? Number(row.volume) : undefined,
      volume1h: row.volume_1h ? Number(row.volume_1h) : undefined,
      buyers1h: row.buyers_1h || undefined,
      sellers1h: row.sellers_1h || undefined,
      priceChange1h: row.price_change_1h ? Number(row.price_change_1h) : undefined,
      topHoldersPercent: row.top_holders_percent ? Number(row.top_holders_percent) : undefined,
      totalHolders: row.total_holders || undefined,
      supply: row.supply ? Number(row.supply) : undefined,
      athMcap: row.ath_mcap ? Number(row.ath_mcap) : undefined,
      tokenAge: row.token_age || undefined,
      avgHolderAge: row.avg_holder_age || undefined,
      freshWallets1d: row.fresh_wallets_1d ? Number(row.fresh_wallets_1d) : undefined,
      freshWallets7d: row.fresh_wallets_7d ? Number(row.fresh_wallets_7d) : undefined,
      exchange: row.exchange || undefined,
      platform: row.platform || undefined,
      twitterLink: row.twitter_link || undefined,
      telegramLink: row.telegram_link || undefined,
      websiteLink: row.website_link || undefined,
      recordedAt: DateTime.fromJSDate(row.recorded_at),
      createdAt: DateTime.fromJSDate(row.created_at),
    };
  }

  /**
   * Get token data history for a token
   */
  async getTokenDataHistory(
    tokenId: number,
    options?: { from?: Date; to?: Date; limit?: number }
  ): Promise<TokenDataRecord[]> {
    const conditions: string[] = ['token_id = $1'];
    const params: unknown[] = [tokenId];
    let paramIndex = 2;

    if (options?.from) {
      conditions.push(`recorded_at >= $${paramIndex}`);
      params.push(options.from);
      paramIndex++;
    }

    if (options?.to) {
      conditions.push(`recorded_at <= $${paramIndex}`);
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
      price: number | null;
      market_cap: number | null;
      liquidity: number | null;
      liquidity_multiplier: number | null;
      volume: number | null;
      volume_1h: number | null;
      buyers_1h: number | null;
      sellers_1h: number | null;
      price_change_1h: number | null;
      top_holders_percent: number | null;
      total_holders: number | null;
      supply: number | null;
      ath_mcap: number | null;
      token_age: string | null;
      avg_holder_age: string | null;
      fresh_wallets_1d: number | null;
      fresh_wallets_7d: number | null;
      exchange: string | null;
      platform: string | null;
      twitter_link: string | null;
      telegram_link: string | null;
      website_link: string | null;
      recorded_at: Date;
      created_at: Date;
    }>(
      `SELECT * FROM token_data
       WHERE ${whereClause}
       ORDER BY recorded_at DESC
       ${limitClause}`,
      params
    );

    return result.rows.map((row) => ({
      id: row.id,
      tokenId: row.token_id,
      price: row.price ? Number(row.price) : undefined,
      marketCap: row.market_cap ? Number(row.market_cap) : undefined,
      liquidity: row.liquidity ? Number(row.liquidity) : undefined,
      liquidityMultiplier: row.liquidity_multiplier ? Number(row.liquidity_multiplier) : undefined,
      volume: row.volume ? Number(row.volume) : undefined,
      volume1h: row.volume_1h ? Number(row.volume_1h) : undefined,
      buyers1h: row.buyers_1h || undefined,
      sellers1h: row.sellers_1h || undefined,
      priceChange1h: row.price_change_1h ? Number(row.price_change_1h) : undefined,
      topHoldersPercent: row.top_holders_percent ? Number(row.top_holders_percent) : undefined,
      totalHolders: row.total_holders || undefined,
      supply: row.supply ? Number(row.supply) : undefined,
      athMcap: row.ath_mcap ? Number(row.ath_mcap) : undefined,
      tokenAge: row.token_age || undefined,
      avgHolderAge: row.avg_holder_age || undefined,
      freshWallets1d: row.fresh_wallets_1d ? Number(row.fresh_wallets_1d) : undefined,
      freshWallets7d: row.fresh_wallets_7d ? Number(row.fresh_wallets_7d) : undefined,
      exchange: row.exchange || undefined,
      platform: row.platform || undefined,
      twitterLink: row.twitter_link || undefined,
      telegramLink: row.telegram_link || undefined,
      websiteLink: row.website_link || undefined,
      recordedAt: DateTime.fromJSDate(row.recorded_at),
      createdAt: DateTime.fromJSDate(row.created_at),
    }));
  }
}

