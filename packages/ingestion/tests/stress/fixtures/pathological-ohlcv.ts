/**
 * Pathological OHLCV Fixtures
 *
 * Extreme edge cases for OHLCV ingestion stress testing.
 * These fixtures are designed to expose weaknesses in the ingestion pipeline.
 */

import { DateTime } from 'luxon';
import type { Candle } from '@quantbot/core';

/**
 * Valid Solana mint address for reference
 */
export const VALID_MINT = 'So11111111111111111111111111111111111111112';

/**
 * Valid EVM address for reference
 */
export const VALID_EVM = '0x1234567890123456789012345678901234567890';

/**
 * Invalid mint addresses that should cause failures
 */
export const INVALID_MINTS = [
  '', // Empty string
  'INVALID', // Too short
  'So1111111111111111111111111111111111111111', // Too short (43 chars)
  'So111111111111111111111111111111111111111123', // Too long (45 chars)
  'So1111111111111111111111111111111111111111O', // Contains O (forbidden)
  'So11111111111111111111111111111111111111110', // Contains 0 (forbidden)
  'So1111111111111111111111111111111111111111I', // Contains I (forbidden)
  'So1111111111111111111111111111111111111111l', // Contains l (forbidden)
  '0x', // Incomplete EVM
  '0x123', // Too short EVM
  '0x12345678901234567890123456789012345678901', // Too long EVM
  '0x0000000000000000000000000000000000000000', // Zero address
  '0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG', // Invalid hex
  'So11111111111111111111111111111111111111112\n', // Newline
  'So11111111111111111111111111111111111111112 ', // Trailing space
  '\u200BSo11111111111111111111111111111111111111112', // Zero-width space
] as const;

/**
 * Extreme date ranges that should stress the system
 */
export const EXTREME_DATE_RANGES = [
  {
    description: 'Future date (should fail or return empty)',
    start: DateTime.utc().plus({ years: 1 }),
    end: DateTime.utc().plus({ years: 2 }),
  },
  {
    description: 'Past date (very old)',
    start: DateTime.utc().minus({ years: 10 }),
    end: DateTime.utc().minus({ years: 9 }),
  },
  {
    description: 'Reversed range (end before start)',
    start: DateTime.utc(),
    end: DateTime.utc().minus({ days: 1 }),
  },
  {
    description: 'Same start and end',
    start: DateTime.utc(),
    end: DateTime.utc(),
  },
  {
    description: 'Very large range (10 years)',
    start: DateTime.utc().minus({ years: 5 }),
    end: DateTime.utc().plus({ years: 5 }),
  },
  {
    description: 'Tiny range (1 second)',
    start: DateTime.utc(),
    end: DateTime.utc().plus({ seconds: 1 }),
  },
  {
    description: 'Invalid timestamp (NaN)',
    start: DateTime.fromMillis(NaN),
    end: DateTime.utc(),
  },
] as const;

/**
 * Pathological candle sequences
 */
export const PATHOLOGICAL_CANDLES: Array<{
  description: string;
  candles: Candle[];
  expectedBehavior: 'reject' | 'normalize' | 'accept';
}> = [
  {
    description: 'Empty candles array',
    candles: [],
    expectedBehavior: 'accept',
  },
  {
    description: 'Single candle',
    candles: [
      {
        timestamp: Math.floor(DateTime.utc().toSeconds()),
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.05,
        volume: 1000,
      },
    ],
    expectedBehavior: 'accept',
  },
  {
    description: 'Negative prices',
    candles: [
      {
        timestamp: Math.floor(DateTime.utc().toSeconds()),
        open: -1.0,
        high: -0.5,
        low: -2.0,
        close: -1.0,
        volume: 1000,
      },
    ],
    expectedBehavior: 'reject',
  },
  {
    description: 'Zero prices',
    candles: [
      {
        timestamp: Math.floor(DateTime.utc().toSeconds()),
        open: 0,
        high: 0,
        low: 0,
        close: 0,
        volume: 1000,
      },
    ],
    expectedBehavior: 'reject',
  },
  {
    description: 'High < Low (impossible)',
    candles: [
      {
        timestamp: Math.floor(DateTime.utc().toSeconds()),
        open: 1.0,
        high: 0.5,
        low: 1.5,
        close: 1.0,
        volume: 1000,
      },
    ],
    expectedBehavior: 'reject',
  },
  {
    description: 'Open/Close outside High/Low range',
    candles: [
      {
        timestamp: Math.floor(DateTime.utc().toSeconds()),
        open: 2.0,
        high: 1.5,
        low: 1.0,
        close: 0.5,
        volume: 1000,
      },
    ],
    expectedBehavior: 'reject',
  },
  {
    description: 'Negative volume',
    candles: [
      {
        timestamp: Math.floor(DateTime.utc().toSeconds()),
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.05,
        volume: -1000,
      },
    ],
    expectedBehavior: 'reject',
  },
  {
    description: 'Extremely large numbers (overflow risk)',
    candles: [
      {
        timestamp: Math.floor(DateTime.utc().toSeconds()),
        open: Number.MAX_VALUE,
        high: Number.MAX_VALUE,
        low: Number.MAX_VALUE,
        close: Number.MAX_VALUE,
        volume: Number.MAX_VALUE,
      },
    ],
    expectedBehavior: 'reject',
  },
  {
    description: 'NaN values',
    candles: [
      {
        timestamp: Math.floor(DateTime.utc().toSeconds()),
        open: NaN,
        high: NaN,
        low: NaN,
        close: NaN,
        volume: NaN,
      },
    ],
    expectedBehavior: 'reject',
  },
  {
    description: 'Infinity values',
    candles: [
      {
        timestamp: Math.floor(DateTime.utc().toSeconds()),
        open: Infinity,
        high: Infinity,
        low: Infinity,
        close: Infinity,
        volume: Infinity,
      },
    ],
    expectedBehavior: 'reject',
  },
  {
    description: 'Duplicate timestamps',
    candles: [
      {
        timestamp: 1000,
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.05,
        volume: 1000,
      },
      {
        timestamp: 1000, // Duplicate
        open: 1.05,
        high: 1.2,
        low: 1.0,
        close: 1.15,
        volume: 2000,
      },
    ],
    expectedBehavior: 'normalize', // Should deduplicate or merge
  },
  {
    description: 'Out-of-order timestamps',
    candles: [
      {
        timestamp: 2000,
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.05,
        volume: 1000,
      },
      {
        timestamp: 1000, // Before previous
        open: 1.05,
        high: 1.2,
        low: 1.0,
        close: 1.15,
        volume: 2000,
      },
    ],
    expectedBehavior: 'normalize', // Should sort
  },
  {
    description: 'Huge gap in timestamps (years)',
    candles: [
      {
        timestamp: Math.floor(DateTime.utc().minus({ years: 5 }).toSeconds()),
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.05,
        volume: 1000,
      },
      {
        timestamp: Math.floor(DateTime.utc().toSeconds()),
        open: 1.05,
        high: 1.2,
        low: 1.0,
        close: 1.15,
        volume: 2000,
      },
    ],
    expectedBehavior: 'accept',
  },
  {
    description: 'Maximum candles (5000)',
    candles: Array.from({ length: 5000 }, (_, i) => ({
      timestamp: Math.floor(
        DateTime.utc()
          .minus({ minutes: 5000 - i })
          .toSeconds()
      ),
      open: 1.0 + i * 0.001,
      high: 1.1 + i * 0.001,
      low: 0.9 + i * 0.001,
      close: 1.05 + i * 0.001,
      volume: 1000 + i,
    })),
    expectedBehavior: 'accept',
  },
  {
    description: 'Over maximum candles (5001)',
    candles: Array.from({ length: 5001 }, (_, i) => ({
      timestamp: Math.floor(
        DateTime.utc()
          .minus({ minutes: 5001 - i })
          .toSeconds()
      ),
      open: 1.0 + i * 0.001,
      high: 1.1 + i * 0.001,
      low: 0.9 + i * 0.001,
      close: 1.05 + i * 0.001,
      volume: 1000 + i,
    })),
    expectedBehavior: 'normalize', // Should chunk
  },
  {
    description: 'Flatline (constant price, zero volume)',
    candles: Array.from({ length: 100 }, () => ({
      timestamp: Math.floor(DateTime.utc().toSeconds()),
      open: 1.0,
      high: 1.0,
      low: 1.0,
      close: 1.0,
      volume: 0,
    })),
    expectedBehavior: 'accept',
  },
  {
    description: 'Extreme price spike',
    candles: [
      {
        timestamp: Math.floor(DateTime.utc().toSeconds()),
        open: 1.0,
        high: 1000000.0, // Extreme spike
        low: 0.0001, // Extreme drop
        close: 1.0,
        volume: 1000,
      },
    ],
    expectedBehavior: 'accept', // Valid but extreme
  },
  {
    description: 'Near-zero prices',
    candles: [
      {
        timestamp: Math.floor(DateTime.utc().toSeconds()),
        open: 0.0000000001,
        high: 0.0000000002,
        low: 0.00000000005,
        close: 0.00000000015,
        volume: 1000000000,
      },
    ],
    expectedBehavior: 'accept',
  },
  {
    description: 'Invalid timestamp (negative)',
    candles: [
      {
        timestamp: -1,
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.05,
        volume: 1000,
      },
    ],
    expectedBehavior: 'reject',
  },
  {
    description: 'Invalid timestamp (too large)',
    candles: [
      {
        timestamp: Number.MAX_SAFE_INTEGER + 1,
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.05,
        volume: 1000,
      },
    ],
    expectedBehavior: 'reject',
  },
  {
    description: 'Mixed valid and invalid candles',
    candles: [
      {
        timestamp: Math.floor(DateTime.utc().toSeconds()),
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.05,
        volume: 1000,
      },
      {
        timestamp: Math.floor(DateTime.utc().plus({ minutes: 1 }).toSeconds()),
        open: NaN,
        high: NaN,
        low: NaN,
        close: NaN,
        volume: NaN,
      },
      {
        timestamp: Math.floor(DateTime.utc().plus({ minutes: 2 }).toSeconds()),
        open: 1.05,
        high: 1.2,
        low: 1.0,
        close: 1.15,
        volume: 2000,
      },
    ],
    expectedBehavior: 'normalize', // Should filter invalid
  },
];

/**
 * API response failures
 */
export const API_FAILURE_SCENARIOS = [
  {
    description: 'Empty response body',
    response: null,
    statusCode: 200,
  },
  {
    description: 'Malformed JSON',
    response: '{ invalid json }',
    statusCode: 200,
  },
  {
    description: 'Missing data field',
    response: { success: true },
    statusCode: 200,
  },
  {
    description: 'Empty items array',
    response: { data: { items: [] } },
    statusCode: 200,
  },
  {
    description: 'Null items',
    response: { data: { items: null } },
    statusCode: 200,
  },
  {
    description: 'Rate limit (429)',
    response: { error: 'Rate limit exceeded' },
    statusCode: 429,
  },
  {
    description: 'Server error (500)',
    response: { error: 'Internal server error' },
    statusCode: 500,
  },
  {
    description: 'Not found (404)',
    response: { error: 'Token not found' },
    statusCode: 404,
  },
  {
    description: 'Timeout',
    response: null,
    statusCode: 0,
    timeout: true,
  },
  {
    description: 'Partial response (incomplete JSON)',
    response: '{"data":{"items":[{"unixTime":',
    statusCode: 200,
  },
  {
    description: 'Wrong data structure (not array)',
    response: { data: { items: { candle: {} } } },
    statusCode: 200,
  },
  {
    description: 'Invalid candle structure',
    response: {
      data: {
        items: [
          {
            // Missing required fields
            unixTime: 1000,
          },
        ],
      },
    },
    statusCode: 200,
  },
] as const;

/**
 * Cache corruption scenarios
 */
export const CACHE_CORRUPTION_SCENARIOS = [
  {
    description: 'Stale cache (expired TTL)',
    cacheAge: 10 * 60 * 1000, // 10 minutes
    ttl: 5 * 60 * 1000, // 5 minutes
  },
  {
    description: 'Corrupted cache entry (invalid JSON)',
    cacheData: '{ invalid json }',
  },
  {
    description: 'Wrong data type in cache',
    cacheData: 'not an array',
  },
  {
    description: 'Empty cache entry',
    cacheData: '[]',
  },
  {
    description: 'Cache entry with wrong mint',
    cacheData: JSON.stringify([
      {
        timestamp: 1000,
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.05,
        volume: 1000,
      },
    ]),
    wrongMint: true,
  },
] as const;

/**
 * Storage failure scenarios
 */
export const STORAGE_FAILURE_SCENARIOS = [
  {
    description: 'ClickHouse connection failure',
    error: 'Connection refused',
  },
  {
    description: 'ClickHouse query timeout',
    error: 'Query timeout',
  },
  {
    description: 'ClickHouse disk full',
    error: 'Disk full',
  },
  {
    description: 'Partial write failure',
    error: 'Partial write',
    partial: true,
  },
  {
    description: 'Schema mismatch',
    error: 'Schema mismatch',
  },
  {
    description: 'Concurrent write conflict',
    error: 'Concurrent write',
  },
] as const;

/**
 * Resource exhaustion scenarios
 */
export const RESOURCE_EXHAUSTION_SCENARIOS = [
  {
    description: 'Too many concurrent requests (1000)',
    concurrentRequests: 1000,
  },
  {
    description: 'Very large response (10MB)',
    responseSize: 10 * 1024 * 1024,
  },
  {
    description: 'Memory exhaustion (1M candles)',
    candleCount: 1_000_000,
  },
  {
    description: 'Cache overflow (exceeds max size)',
    cacheEntries: 1000,
    maxCacheSize: 500,
  },
] as const;
