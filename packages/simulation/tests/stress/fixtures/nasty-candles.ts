/**
 * Nasty Candle Fixtures
 *
 * Pathological candle sequences for simulation stress testing.
 * Tests that the simulation engine handles edge cases gracefully.
 */

export interface CandleSequence {
  description: string;
  candles: Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  expectedBehavior: 'reject' | 'accept' | 'warn';
  expectedError?: string;
  category: 'flatline' | 'spike' | 'gap' | 'duplicate' | 'ordering' | 'invalid' | 'tiny';
}

const BASE_TIMESTAMP = 1704067200000; // 2024-01-01 00:00:00 UTC
const FIVE_MINUTES = 5 * 60 * 1000;

/**
 * Flatline sequences (constant price)
 */
export const FLATLINE_SEQUENCES: CandleSequence[] = [
  {
    description: 'Constant price (no movement)',
    candles: Array.from({ length: 100 }, (_, i) => ({
      timestamp: BASE_TIMESTAMP + i * FIVE_MINUTES,
      open: 1.0,
      high: 1.0,
      low: 1.0,
      close: 1.0,
      volume: 1000,
    })),
    expectedBehavior: 'accept',
    category: 'flatline',
  },
  {
    description: 'Zero volume flatline',
    candles: Array.from({ length: 100 }, (_, i) => ({
      timestamp: BASE_TIMESTAMP + i * FIVE_MINUTES,
      open: 1.0,
      high: 1.0,
      low: 1.0,
      close: 1.0,
      volume: 0,
    })),
    expectedBehavior: 'accept',
    category: 'flatline',
  },
];

/**
 * Spike sequences (extreme outliers)
 */
export const SPIKE_SEQUENCES: CandleSequence[] = [
  {
    description: 'Single massive spike',
    candles: [
      ...Array.from({ length: 50 }, (_, i) => ({
        timestamp: BASE_TIMESTAMP + i * FIVE_MINUTES,
        open: 1.0,
        high: 1.01,
        low: 0.99,
        close: 1.0,
        volume: 1000,
      })),
      {
        timestamp: BASE_TIMESTAMP + 50 * FIVE_MINUTES,
        open: 1.0,
        high: 1000000.0, // Massive spike
        low: 1.0,
        close: 1.0,
        volume: 1000,
      },
      ...Array.from({ length: 49 }, (_, i) => ({
        timestamp: BASE_TIMESTAMP + (51 + i) * FIVE_MINUTES,
        open: 1.0,
        high: 1.01,
        low: 0.99,
        close: 1.0,
        volume: 1000,
      })),
    ],
    expectedBehavior: 'accept',
    category: 'spike',
  },
  {
    description: 'Spike to near-zero',
    candles: [
      ...Array.from({ length: 50 }, (_, i) => ({
        timestamp: BASE_TIMESTAMP + i * FIVE_MINUTES,
        open: 1.0,
        high: 1.01,
        low: 0.99,
        close: 1.0,
        volume: 1000,
      })),
      {
        timestamp: BASE_TIMESTAMP + 50 * FIVE_MINUTES,
        open: 1.0,
        high: 1.0,
        low: 0.0000001, // Near-zero spike
        close: 1.0,
        volume: 1000,
      },
      ...Array.from({ length: 49 }, (_, i) => ({
        timestamp: BASE_TIMESTAMP + (51 + i) * FIVE_MINUTES,
        open: 1.0,
        high: 1.01,
        low: 0.99,
        close: 1.0,
        volume: 1000,
      })),
    ],
    expectedBehavior: 'accept',
    category: 'spike',
  },
  {
    description: 'Volume spike (10000x normal)',
    candles: [
      ...Array.from({ length: 50 }, (_, i) => ({
        timestamp: BASE_TIMESTAMP + i * FIVE_MINUTES,
        open: 1.0,
        high: 1.01,
        low: 0.99,
        close: 1.0,
        volume: 1000,
      })),
      {
        timestamp: BASE_TIMESTAMP + 50 * FIVE_MINUTES,
        open: 1.0,
        high: 1.01,
        low: 0.99,
        close: 1.0,
        volume: 10000000, // Massive volume spike
      },
      ...Array.from({ length: 49 }, (_, i) => ({
        timestamp: BASE_TIMESTAMP + (51 + i) * FIVE_MINUTES,
        open: 1.0,
        high: 1.01,
        low: 0.99,
        close: 1.0,
        volume: 1000,
      })),
    ],
    expectedBehavior: 'accept',
    category: 'spike',
  },
];

/**
 * Gap sequences (missing candles)
 */
export const GAP_SEQUENCES: CandleSequence[] = [
  {
    description: 'Single missing candle',
    candles: [
      ...Array.from({ length: 50 }, (_, i) => ({
        timestamp: BASE_TIMESTAMP + i * FIVE_MINUTES,
        open: 1.0,
        high: 1.01,
        low: 0.99,
        close: 1.0,
        volume: 1000,
      })),
      // Skip candle at index 50
      ...Array.from({ length: 49 }, (_, i) => ({
        timestamp: BASE_TIMESTAMP + (51 + i) * FIVE_MINUTES,
        open: 1.0,
        high: 1.01,
        low: 0.99,
        close: 1.0,
        volume: 1000,
      })),
    ],
    expectedBehavior: 'accept',
    category: 'gap',
  },
  {
    description: 'Large gap (10 missing candles)',
    candles: [
      ...Array.from({ length: 50 }, (_, i) => ({
        timestamp: BASE_TIMESTAMP + i * FIVE_MINUTES,
        open: 1.0,
        high: 1.01,
        low: 0.99,
        close: 1.0,
        volume: 1000,
      })),
      // Skip 10 candles
      ...Array.from({ length: 40 }, (_, i) => ({
        timestamp: BASE_TIMESTAMP + (60 + i) * FIVE_MINUTES,
        open: 1.0,
        high: 1.01,
        low: 0.99,
        close: 1.0,
        volume: 1000,
      })),
    ],
    expectedBehavior: 'accept',
    category: 'gap',
  },
  {
    description: 'Random gaps throughout',
    candles: Array.from({ length: 100 }, (_, i) => {
      // Create gaps but keep timestamps monotonic
      // Every 3rd candle has a 2x gap, but we accumulate to maintain order
      let timestampOffset = 0;
      for (let j = 0; j <= i; j++) {
        timestampOffset += FIVE_MINUTES * (j % 3 === 0 ? 2 : 1);
      }
      return {
        timestamp: BASE_TIMESTAMP + timestampOffset,
        open: 1.0,
        high: 1.01,
        low: 0.99,
        close: 1.0,
        volume: 1000,
      };
    }),
    expectedBehavior: 'accept',
    category: 'gap',
  },
];

/**
 * Duplicate sequences (same timestamp)
 */
export const DUPLICATE_SEQUENCES: CandleSequence[] = [
  {
    description: 'Duplicate timestamp (same data)',
    candles: [
      ...Array.from({ length: 50 }, (_, i) => ({
        timestamp: BASE_TIMESTAMP + i * FIVE_MINUTES,
        open: 1.0,
        high: 1.01,
        low: 0.99,
        close: 1.0,
        volume: 1000,
      })),
      {
        timestamp: BASE_TIMESTAMP + 49 * FIVE_MINUTES, // Duplicate
        open: 1.0,
        high: 1.01,
        low: 0.99,
        close: 1.0,
        volume: 1000,
      },
      ...Array.from({ length: 49 }, (_, i) => ({
        timestamp: BASE_TIMESTAMP + (50 + i) * FIVE_MINUTES,
        open: 1.0,
        high: 1.01,
        low: 0.99,
        close: 1.0,
        volume: 1000,
      })),
    ],
    expectedBehavior: 'reject',
    expectedError: 'duplicate_timestamp',
    category: 'duplicate',
  },
  {
    description: 'Duplicate timestamp (different data)',
    candles: [
      ...Array.from({ length: 50 }, (_, i) => ({
        timestamp: BASE_TIMESTAMP + i * FIVE_MINUTES,
        open: 1.0,
        high: 1.01,
        low: 0.99,
        close: 1.0,
        volume: 1000,
      })),
      {
        timestamp: BASE_TIMESTAMP + 49 * FIVE_MINUTES, // Duplicate with different data
        open: 2.0,
        high: 2.01,
        low: 1.99,
        close: 2.0,
        volume: 2000,
      },
      ...Array.from({ length: 49 }, (_, i) => ({
        timestamp: BASE_TIMESTAMP + (50 + i) * FIVE_MINUTES,
        open: 1.0,
        high: 1.01,
        low: 0.99,
        close: 1.0,
        volume: 1000,
      })),
    ],
    expectedBehavior: 'reject',
    expectedError: 'duplicate_timestamp',
    category: 'duplicate',
  },
];

/**
 * Out-of-order sequences
 */
export const OUT_OF_ORDER_SEQUENCES: CandleSequence[] = [
  {
    description: 'Non-monotonic timestamps',
    candles: [
      { timestamp: BASE_TIMESTAMP, open: 1.0, high: 1.01, low: 0.99, close: 1.0, volume: 1000 },
      {
        timestamp: BASE_TIMESTAMP + 2 * FIVE_MINUTES,
        open: 1.0,
        high: 1.01,
        low: 0.99,
        close: 1.0,
        volume: 1000,
      },
      {
        timestamp: BASE_TIMESTAMP + 1 * FIVE_MINUTES,
        open: 1.0,
        high: 1.01,
        low: 0.99,
        close: 1.0,
        volume: 1000,
      }, // Out of order
      {
        timestamp: BASE_TIMESTAMP + 3 * FIVE_MINUTES,
        open: 1.0,
        high: 1.01,
        low: 0.99,
        close: 1.0,
        volume: 1000,
      },
    ],
    expectedBehavior: 'reject',
    expectedError: 'non_monotonic_timestamps',
    category: 'ordering',
  },
  {
    description: 'Completely reversed',
    candles: Array.from({ length: 100 }, (_, i) => ({
      timestamp: BASE_TIMESTAMP + (99 - i) * FIVE_MINUTES, // Reversed
      open: 1.0,
      high: 1.01,
      low: 0.99,
      close: 1.0,
      volume: 1000,
    })),
    expectedBehavior: 'reject',
    expectedError: 'non_monotonic_timestamps',
    category: 'ordering',
  },
];

/**
 * Invalid data sequences
 */
export const INVALID_SEQUENCES: CandleSequence[] = [
  {
    description: 'Negative price',
    candles: [
      { timestamp: BASE_TIMESTAMP, open: -1.0, high: 1.01, low: 0.99, close: 1.0, volume: 1000 },
    ],
    expectedBehavior: 'reject',
    expectedError: 'negative_price',
    category: 'invalid',
  },
  {
    description: 'Zero price',
    candles: [{ timestamp: BASE_TIMESTAMP, open: 0, high: 0, low: 0, close: 0, volume: 1000 }],
    expectedBehavior: 'reject',
    expectedError: 'zero_price',
    category: 'invalid',
  },
  {
    description: 'Negative volume',
    candles: [
      { timestamp: BASE_TIMESTAMP, open: 1.0, high: 1.01, low: 0.99, close: 1.0, volume: -1000 },
    ],
    expectedBehavior: 'reject',
    expectedError: 'negative_volume',
    category: 'invalid',
  },
  {
    description: 'High < Low',
    candles: [
      { timestamp: BASE_TIMESTAMP, open: 1.0, high: 0.99, low: 1.01, close: 1.0, volume: 1000 },
    ],
    expectedBehavior: 'reject',
    expectedError: 'high_less_than_low',
    category: 'invalid',
  },
  {
    description: 'Open/Close outside High/Low range',
    candles: [
      { timestamp: BASE_TIMESTAMP, open: 1.5, high: 1.01, low: 0.99, close: 1.0, volume: 1000 },
    ],
    expectedBehavior: 'reject',
    expectedError: 'ohlc_inconsistent',
    category: 'invalid',
  },
];

/**
 * Tiny datasets (insufficient for indicators)
 */
export const TINY_SEQUENCES: CandleSequence[] = [
  {
    description: 'Single candle',
    candles: [
      { timestamp: BASE_TIMESTAMP, open: 1.0, high: 1.01, low: 0.99, close: 1.0, volume: 1000 },
    ],
    expectedBehavior: 'reject',
    expectedError: 'insufficient_data',
    category: 'tiny',
  },
  {
    description: 'Five candles (less than typical indicator warmup)',
    candles: Array.from({ length: 5 }, (_, i) => ({
      timestamp: BASE_TIMESTAMP + i * FIVE_MINUTES,
      open: 1.0,
      high: 1.01,
      low: 0.99,
      close: 1.0,
      volume: 1000,
    })),
    expectedBehavior: 'reject',
    expectedError: 'insufficient_data',
    category: 'tiny',
  },
  {
    description: 'Exactly 52 candles (minimum for Ichimoku)',
    candles: Array.from({ length: 52 }, (_, i) => ({
      timestamp: BASE_TIMESTAMP + i * FIVE_MINUTES,
      open: 1.0,
      high: 1.01,
      low: 0.99,
      close: 1.0,
      volume: 1000,
    })),
    expectedBehavior: 'accept',
    category: 'tiny',
  },
];

/**
 * Order-of-events ambiguity sequences
 */
export const AMBIGUITY_SEQUENCES: CandleSequence[] = [
  {
    description: 'Stop loss and take profit in same candle',
    candles: [
      ...Array.from({ length: 51 }, (_, i) => ({
        timestamp: BASE_TIMESTAMP + i * FIVE_MINUTES,
        open: 1.0,
        high: 1.01,
        low: 0.99,
        close: 1.0,
        volume: 1000,
      })),
      {
        timestamp: BASE_TIMESTAMP + 51 * FIVE_MINUTES,
        open: 1.0,
        high: 1.5, // Hits take profit
        low: 0.5, // Hits stop loss
        close: 1.0,
        volume: 1000,
      },
    ],
    expectedBehavior: 'warn',
    category: 'spike',
  },
  {
    description: 'Entry and exit signal in same candle',
    candles: [
      ...Array.from({ length: 51 }, (_, i) => ({
        timestamp: BASE_TIMESTAMP + i * FIVE_MINUTES,
        open: 1.0,
        high: 1.01,
        low: 0.99,
        close: 1.0,
        volume: 1000,
      })),
      {
        timestamp: BASE_TIMESTAMP + 51 * FIVE_MINUTES,
        open: 0.5,
        high: 2.0, // Wide range could trigger both entry and exit
        low: 0.5,
        close: 1.5,
        volume: 10000,
      },
    ],
    expectedBehavior: 'warn',
    category: 'spike',
  },
];

/**
 * All sequences combined
 */
export const ALL_SEQUENCES: CandleSequence[] = [
  ...FLATLINE_SEQUENCES,
  ...SPIKE_SEQUENCES,
  ...GAP_SEQUENCES,
  ...DUPLICATE_SEQUENCES,
  ...OUT_OF_ORDER_SEQUENCES,
  ...INVALID_SEQUENCES,
  ...TINY_SEQUENCES,
  ...AMBIGUITY_SEQUENCES,
];
