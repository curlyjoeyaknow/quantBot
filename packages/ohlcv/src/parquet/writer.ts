/**
 * Parquet Writer for OHLCV Candles
 *
 * Writes candle data to Parquet files.
 * Uses PythonEngine to leverage PyArrow for efficient Parquet writing.
 */

import type { Candle } from '@quantbot/core';
import { PythonEngine } from '@quantbot/utils';
import { z } from 'zod';

/**
 * Write candles to Parquet file
 *
 * @param candles - Array of candles
 * @param outputPath - Output file path
 */
export async function writeCandlesToParquet(candles: Candle[], outputPath: string): Promise<void> {
  const pythonEngine = new PythonEngine();

  // Convert candles to records (Python-friendly format)
  const records = candles.map((candle) => ({
    timestamp: candle.timestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  }));

  // Write to Parquet using Python
  await pythonEngine.runScript(
    'tools/storage/write_parquet.py',
    {
      output: outputPath,
      data: JSON.stringify(records),
    },
    z.object({
      success: z.boolean(),
      rowCount: z.number(),
      error: z.string().optional(),
    }),
    {
      cwd: process.cwd(),
    }
  );
}

/**
 * Get Parquet schema for candles
 *
 * @returns PyArrow schema definition
 */
export function getCandleParquetSchema(): Record<string, string> {
  return {
    timestamp: 'int64', // UNIX timestamp in seconds
    open: 'float64',
    high: 'float64',
    low: 'float64',
    close: 'float64',
    volume: 'float64',
  };
}
