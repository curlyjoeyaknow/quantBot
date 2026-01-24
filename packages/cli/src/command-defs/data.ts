/**
 * Data Command Definitions
 */

import { z } from 'zod';

export const rawDataListSchema = z.object({
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export const rawDataQuerySchema = z.object({
  from: z.string().optional(), // ISO 8601 date
  to: z.string().optional(), // ISO 8601 date
  sourceType: z
    .enum(['telegram_export', 'api_response', 'file_upload', 'stream_event'])
    .optional(),
  sourceId: z.string().optional(),
  hash: z.string().optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export const canonicalQuerySchema = z.object({
  assetAddress: z.string().optional(),
  chain: z.enum(['solana', 'ethereum', 'bsc', 'base', 'evm']).optional(),
  venueName: z.string().optional(),
  venueType: z.enum(['dex', 'cex', 'data_provider', 'social', 'on_chain']).optional(),
  eventType: z
    .enum(['price', 'trade', 'alert', 'candle', 'volume', 'liquidity', 'metadata'])
    .optional(),
  from: z.string().optional(), // ISO 8601 date
  to: z.string().optional(), // ISO 8601 date
  sourceHash: z.string().optional(),
  sourceRunId: z.string().optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export const canonicalGetByAssetSchema = z.object({
  assetAddress: z.string(),
  from: z.string().optional(), // ISO 8601 date
  to: z.string().optional(), // ISO 8601 date
  eventTypes: z
    .array(z.enum(['price', 'trade', 'alert', 'candle', 'volume', 'liquidity', 'metadata']))
    .optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});
