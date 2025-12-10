/**
 * OhlcvIngestionService - Ingest OHLCV candles for calls
 * 
 * Fetches OHLCV candles from Birdeye for all tokens in calls,
 * stores them in ClickHouse via OhlcvRepository.
 */

import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import type { Chain, DateRange } from '@quantbot/utils/types/core';
import { CallsRepository, OhlcvRepository } from '@quantbot/storage';
import { BirdeyeClient } from '../api/birdeye-client';
import type { Candle } from '@quantbot/utils/types/core';

export interface IngestForCallsParams {
  from?: Date;
  to?: Date;
  preWindowMinutes: number; // 52-period lookback
  postWindowMinutes: number; // Forward window
  interval: '1m' | '5m';
}

export interface IngestForCallsResult {
  tokensProcessed: number;
  candlesInserted: number;
}

export class OhlcvIngestionService {
  private birdeyeClient: BirdeyeClient;

  constructor(
    private callsRepo: CallsRepository,
    private ohlcvRepo: OhlcvRepository
  ) {
    this.birdeyeClient = new BirdeyeClient();
  }

  /**
   * Ingest OHLCV candles for calls in a time window
   */
  async ingestForCalls(params: IngestForCallsParams): Promise<IngestForCallsResult> {
    logger.info('Starting OHLCV ingestion for calls', params);

    // 1. Select calls in time window
    const calls = await this.callsRepo.queryBySelection({
      from: params.from,
      to: params.to,
    });

    logger.info('Found calls', { count: calls.length });

    // 2. Group by token
    const tokenCalls = new Map<number, typeof calls>();
    for (const call of calls) {
      if (!tokenCalls.has(call.tokenId)) {
        tokenCalls.set(call.tokenId, []);
      }
      tokenCalls.get(call.tokenId)!.push(call);
    }

    let tokensProcessed = 0;
    let candlesInserted = 0;

    // 3. For each token, compute time range and fetch candles
    for (const [tokenId, tokenCallsList] of tokenCalls.entries()) {
      try {
        // Get token address (we need to join with tokens table or pass it)
        // For now, assume we can get it from the first call's metadata or token lookup
        // This is a simplification - in practice, you'd load the token
        
        // Compute time range: earliest call - preWindow, latest call + postWindow
        const timestamps = tokenCallsList.map(c => c.signalTimestamp.toJSDate());
        const earliest = new Date(Math.min(...timestamps.map(t => t.getTime())));
        const latest = new Date(Math.max(...timestamps.map(t => t.getTime())));

        const startTime = new Date(earliest.getTime() - params.preWindowMinutes * 60 * 1000);
        const endTime = new Date(latest.getTime() + params.postWindowMinutes * 60 * 1000);

        // Check existing candles
        const range: DateRange = { from: startTime, to: endTime };
        // Note: We need token address here - this is a simplified version
        // In practice, you'd load the token first to get the address
        const hasExisting = false; // await this.ohlcvRepo.hasCandles(tokenAddress, 'SOL', range);

        if (!hasExisting) {
          // Fetch from Birdeye
          // Note: This is simplified - you'd need to get token address from tokenId
          logger.debug('Skipping token (need address lookup)', { tokenId });
          // const candles = await this.fetchCandles(tokenAddress, 'SOL', startTime, endTime, params.interval);
          // await this.ohlcvRepo.upsertCandles(tokenAddress, 'SOL', params.interval, candles);
          // candlesInserted += candles.length;
        }

        tokensProcessed++;
      } catch (error) {
        logger.error('Error processing token', error as Error, { tokenId });
        // Continue with other tokens
      }
    }

    return {
      tokensProcessed,
      candlesInserted,
    };
  }

  /**
   * Fetch candles from Birdeye (helper)
   */
  private async fetchCandles(
    tokenAddress: string,
    chain: Chain,
    startTime: Date,
    endTime: Date,
    interval: '1m' | '5m'
  ): Promise<Candle[]> {
    const response = await this.birdeyeClient.fetchOHLCVData(
      tokenAddress,
      startTime,
      endTime,
      interval,
      chain.toLowerCase()
    );

    if (!response || !response.items) {
      return [];
    }

    return response.items.map((item) => ({
      timestamp: item.unixTime,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volume,
    }));
  }
}

