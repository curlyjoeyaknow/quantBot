/**
 * ClickHouse Data Loader
 * 
 * Loads trading call data from ClickHouse database
 */

import { DateTime } from 'luxon';
import { queryCandles, getClickHouseClient } from '../../storage/clickhouse-client';
import { DataLoader, LoadParams, LoadResult, ClickHouseLoadParams } from './types';

export class ClickHouseDataLoader implements DataLoader {
  public readonly name = 'clickhouse-loader';

  async load(params: LoadParams): Promise<LoadResult[]> {
    const chParams = params as ClickHouseLoadParams;
    
    // If custom query provided, use it
    if (chParams.query) {
      const client = getClickHouseClient();
      const result = await client.query({
        query: chParams.query,
        format: 'JSONEachRow',
      });
      
      const data = await result.json();
      return this.transformResults(data as any[]);
    }

    // Otherwise, query candles and transform
    if (!chParams.mint || !chParams.startTime || !chParams.endTime) {
      throw new Error('ClickHouse loader requires mint, startTime, and endTime for candle queries');
    }

    const chain = chParams.chain || 'solana';
    const candles = await queryCandles(chParams.mint, chain, chParams.startTime, chParams.endTime);

    // Transform candles to LoadResult format
    // For candle queries, we create a single result entry
    if (candles.length === 0) {
      return [];
    }

    return [{
      mint: chParams.mint,
      chain,
      timestamp: chParams.startTime,
      tokenAddress: chParams.mint,
      // Include metadata if available
      candlesCount: candles.length,
      firstCandle: candles[0],
      lastCandle: candles[candles.length - 1],
    }];
  }

  canLoad(source: string): boolean {
    return source === 'clickhouse' || source.startsWith('clickhouse://');
  }

  private transformResults(rows: any[]): LoadResult[] {
    return rows.map(row => ({
      mint: row.token_address || row.mint || row.tokenAddress,
      chain: row.chain || 'solana',
      timestamp: row.timestamp 
        ? DateTime.fromJSDate(new Date(row.timestamp))
        : DateTime.now(),
      tokenAddress: row.token_address || row.mint || row.tokenAddress,
      tokenSymbol: row.token_symbol || row.symbol,
      tokenName: row.token_name || row.name,
      caller: row.caller || row.creator || row.sender,
      ...row,
    }));
  }
}

