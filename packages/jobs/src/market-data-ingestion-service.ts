/**
 * MarketDataIngestionService - Ingest market creation and token creation data from Birdeye
 *
 * Fetches market creation data and token creation info for all tokens in the database
 * and stores them in ClickHouse for correlation analysis with price/volume pumps.
 */

import { DateTime } from 'luxon';
import { logger, getClickHouseDatabaseName, isSolanaAddress } from '@quantbot/infra/utils';
import { BirdeyeClient } from '@quantbot/infra/api-clients';
import { getClickHouseClient } from '@quantbot/infra/storage';
import { randomUUID } from 'crypto';

export interface IngestMarketDataParams {
  chain?: string; // Default: 'solana'
  limit?: number; // Limit number of tokens to process (for testing)
  skipExisting?: boolean; // Skip tokens that already have market data (default: false)
}

export interface IngestMarketDataResult {
  tokensProcessed: number;
  tokensSucceeded: number;
  tokensFailed: number;
  marketsInserted: number;
  tokenCreationInfoInserted: number;
  errors: Array<{ token: string; error: string }>;
}

export class MarketDataIngestionService {
  private birdeyeClient: BirdeyeClient;
  private ingestionRunId: string;

  constructor(birdeyeClient?: BirdeyeClient) {
    this.birdeyeClient = birdeyeClient || new BirdeyeClient();
    this.ingestionRunId = randomUUID();
  }

  /**
   * Ingest market creation data and token creation info for all tokens
   */
  async ingestForAllTokens(params: IngestMarketDataParams = {}): Promise<IngestMarketDataResult> {
    const chain = params.chain || 'solana';
    const limit = params.limit;
    const skipExisting = params.skipExisting || false;

    logger.info('Starting market data ingestion', {
      chain,
      limit,
      skipExisting,
      runId: this.ingestionRunId,
    });

    // Get all unique token addresses from ClickHouse
    const tokens = await this.getUniqueTokens(chain, limit, skipExisting);

    logger.info('Found tokens to process', {
      count: tokens.length,
      chain,
    });

    const result: IngestMarketDataResult = {
      tokensProcessed: 0,
      tokensSucceeded: 0,
      tokensFailed: 0,
      marketsInserted: 0,
      tokenCreationInfoInserted: 0,
      errors: [],
    };

    // Process tokens in batches to avoid overwhelming the API
    const BATCH_SIZE = 10;
    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batch = tokens.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map((token) => this.processToken(token, chain))
      );

      for (let j = 0; j < batchResults.length; j++) {
        const token = batch[j];
        const batchResult = batchResults[j];
        result.tokensProcessed++;

        if (batchResult.status === 'fulfilled') {
          const tokenResult = batchResult.value;
          result.tokensSucceeded++;
          result.marketsInserted += tokenResult.marketsInserted;
          result.tokenCreationInfoInserted += tokenResult.tokenCreationInfoInserted;
        } else {
          result.tokensFailed++;
          result.errors.push({
            token,
            error:
              batchResult.reason instanceof Error
                ? batchResult.reason.message
                : String(batchResult.reason),
          });
        }
      }

      // Rate limiting: wait between batches
      if (i + BATCH_SIZE < tokens.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second delay
      }
    }

    logger.info('Completed market data ingestion', {
      ...result,
      runId: this.ingestionRunId,
    });

    return result;
  }

  /**
   * Get unique token addresses from ClickHouse
   */
  private async getUniqueTokens(
    chain: string,
    limit?: number,
    skipExisting?: boolean
  ): Promise<string[]> {
    const ch = getClickHouseClient();
    const database = getClickHouseDatabaseName();

    let query = `
      SELECT DISTINCT token_address as mint
      FROM ${database}.ohlcv_candles
      WHERE chain = {chain:String}
    `;

    if (skipExisting) {
      // Skip tokens that already have market data
      query = `
        SELECT DISTINCT o.token_address as mint
        FROM ${database}.ohlcv_candles o
        LEFT JOIN ${database}.market_creation m ON o.token_address = m.base_mint AND o.chain = m.chain
        WHERE o.chain = {chain:String}
          AND m.base_mint IS NULL
      `;
    }

    if (limit) {
      query += ` LIMIT ${limit}`;
    }

    const result = await ch.query({
      query,
      format: 'JSONEachRow',
      query_params: { chain },
    });

    const rows = (await result.json()) as Array<{ mint: string }>;
    return rows.map((row) => row.mint);
  }

  /**
   * Process a single token: fetch and store market data and token creation info
   */
  private async processToken(
    tokenAddress: string,
    chain: string
  ): Promise<{ marketsInserted: number; tokenCreationInfoInserted: number }> {
    let marketsInserted = 0;
    let tokenCreationInfoInserted = 0;

    try {
      // Fetch market creation data
      const markets = await this.birdeyeClient.searchMarkets(tokenAddress, 'all');
      if (markets && markets.length > 0) {
        marketsInserted = await this.insertMarkets(tokenAddress, chain, markets);
      }

      // Fetch token creation info (only for Solana tokens)
      // Check both chain parameter AND actual address format, since database may have incorrect chain values
      if (chain === 'solana' && isSolanaAddress(tokenAddress)) {
        const creationInfo = await this.birdeyeClient.fetchTokenCreationInfo(tokenAddress, chain);
        if (creationInfo) {
          tokenCreationInfoInserted = await this.insertTokenCreationInfo(
            tokenAddress,
            chain,
            creationInfo
          );
        }
      }
    } catch (error: unknown) {
      logger.warn('Failed to process token', {
        token: tokenAddress,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    return { marketsInserted, tokenCreationInfoInserted };
  }

  /**
   * Insert market creation data into ClickHouse
   */
  private async insertMarkets(
    baseMint: string,
    chain: string,
    markets: Array<{
      name: string;
      address: string;
      network: string;
      liquidity: number;
      unique_wallet_24h: number;
      trade_24h: number;
      trade_24h_change_percent: number | null;
      volume_24h_usd: number;
      last_trade_unix_time: number;
      last_trade_human_time: string;
      amount_base: number;
      amount_quote: number;
      base_mint: string;
      quote_mint: string;
      source: string;
      creation_time: string;
      is_scaled_ui_token_base: boolean;
      multiplier_base: number | null;
      is_scaled_ui_token_quote: boolean;
      multiplier_quote: number | null;
    }>
  ): Promise<number> {
    if (markets.length === 0) {
      return 0;
    }

    const ch = getClickHouseClient();
    const database = getClickHouseDatabaseName();

    const rows = markets.map((market) => {
      // Parse creation_time and last_trade_human_time to DateTime
      // Handle invalid or missing dates gracefully
      let creationTime: DateTime;
      try {
        creationTime = DateTime.fromISO(market.creation_time);
        if (!creationTime.isValid) {
          // Fallback to Unix timestamp if ISO parsing fails
          creationTime = DateTime.fromSeconds(market.last_trade_unix_time || 0);
        }
      } catch {
        creationTime = DateTime.fromSeconds(market.last_trade_unix_time || 0);
      }

      let lastTradeTime: DateTime;
      try {
        if (market.last_trade_human_time) {
          lastTradeTime = DateTime.fromISO(market.last_trade_human_time);
          if (!lastTradeTime.isValid) {
            // Fallback to Unix timestamp if ISO parsing fails
            lastTradeTime = DateTime.fromSeconds(market.last_trade_unix_time || 0);
          }
        } else {
          // Use Unix timestamp if human time is missing
          lastTradeTime = DateTime.fromSeconds(market.last_trade_unix_time || 0);
        }
      } catch {
        lastTradeTime = DateTime.fromSeconds(market.last_trade_unix_time || 0);
      }

      // Ensure we have valid dates (fallback to epoch if all else fails)
      if (!creationTime.isValid) {
        creationTime = DateTime.fromSeconds(0);
      }
      if (!lastTradeTime.isValid) {
        lastTradeTime = DateTime.fromSeconds(0);
      }

      return {
        base_mint: market.base_mint,
        quote_mint: market.quote_mint,
        market_address: market.address,
        chain: market.network || chain,
        name: market.name,
        source: market.source,
        liquidity: market.liquidity,
        unique_wallet_24h: market.unique_wallet_24h,
        trade_24h: market.trade_24h,
        trade_24h_change_percent: market.trade_24h_change_percent,
        volume_24h_usd: market.volume_24h_usd,
        amount_base: market.amount_base,
        amount_quote: market.amount_quote,
        creation_time: creationTime.toFormat('yyyy-MM-dd HH:mm:ss'),
        last_trade_unix_time: market.last_trade_unix_time,
        last_trade_human_time: lastTradeTime.toFormat('yyyy-MM-dd HH:mm:ss'),
        is_scaled_ui_token_base: market.is_scaled_ui_token_base ? 1 : 0,
        multiplier_base: market.multiplier_base,
        is_scaled_ui_token_quote: market.is_scaled_ui_token_quote ? 1 : 0,
        multiplier_quote: market.multiplier_quote,
        ingestion_run_id: this.ingestionRunId,
      };
    });

    try {
      await ch.insert({
        table: `${database}.market_creation`,
        values: rows,
        format: 'JSONEachRow',
      });

      logger.debug('Inserted market creation data', {
        baseMint,
        count: rows.length,
      });

      return rows.length;
    } catch (error: unknown) {
      logger.error('Failed to insert market creation data', error as Error, {
        baseMint,
        count: rows.length,
      });
      throw error;
    }
  }

  /**
   * Insert token creation info into ClickHouse
   */
  private async insertTokenCreationInfo(
    tokenAddress: string,
    chain: string,
    creationInfo: {
      txHash: string;
      slot: number;
      tokenAddress: string;
      decimals: number;
      owner: string;
      blockUnixTime: number;
      blockHumanTime: string;
      creator?: string;
    }
  ): Promise<number> {
    const ch = getClickHouseClient();
    const database = getClickHouseDatabaseName();

    // Parse block_human_time to DateTime
    const blockHumanTime = DateTime.fromISO(creationInfo.blockHumanTime);

    const row = {
      token_address: creationInfo.tokenAddress,
      chain: chain,
      tx_hash: creationInfo.txHash,
      slot: creationInfo.slot,
      decimals: creationInfo.decimals,
      owner: creationInfo.owner,
      creator: creationInfo.creator || null,
      block_unix_time: creationInfo.blockUnixTime,
      block_human_time: blockHumanTime.toFormat('yyyy-MM-dd HH:mm:ss'),
      ingestion_run_id: this.ingestionRunId,
    };

    try {
      await ch.insert({
        table: `${database}.token_creation_info`,
        values: [row],
        format: 'JSONEachRow',
      });

      logger.debug('Inserted token creation info', {
        tokenAddress,
      });

      return 1;
    } catch (error: unknown) {
      logger.error('Failed to insert token creation info', error as Error, {
        tokenAddress,
      });
      throw error;
    }
  }
}
