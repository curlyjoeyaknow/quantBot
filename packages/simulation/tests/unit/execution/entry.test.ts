import { describe, it, expect } from 'vitest';
import {
  detectEntry,
  DEFAULT_ENTRY_CONFIG,
  calculateEntryDelay,
} from '../../../src/execution/entry';
import type { Candle } from '../../../src/types/candle';
import type { EntryConfig } from '../../../src/types';

describe('Entry Detection', () => {
  const mockCandles: Candle[] = [
    { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
    { timestamp: 2000, open: 1.05, high: 1.2, low: 1.0, close: 1.15, volume: 1200 },
    { timestamp: 3000, open: 1.15, high: 1.3, low: 1.1, close: 1.25, volume: 1500 },
  ];

  describe('detectEntry', () => {
    it('should enter immediately when no entry conditions', () => {
      const result = detectEntry(mockCandles, 0, DEFAULT_ENTRY_CONFIG);
      expect(result.shouldEnter).toBe(true);
      expect(result.type).toBe('immediate');
      expect(result.price).toBe(1.0);
    });

    it('should detect initial drop entry', () => {
      const config: EntryConfig = {
        initialEntry: -0.1, // 10% drop
        trailingEntry: 'none',
        maxWaitTime: 60,
      };
      const result = detectEntry(mockCandles, 0, config);
      // Should find entry at 0.9 (10% drop from 1.0)
      expect(result.shouldEnter).toBe(true);
      expect(result.type).toBe('initial_drop');
    });

    it('should not enter if drop never occurs', () => {
      const config: EntryConfig = {
        initialEntry: -0.5, // 50% drop (won't happen)
        trailingEntry: 'none',
        maxWaitTime: 60,
      };
      const result = detectEntry(mockCandles, 0, config);
      expect(result.shouldEnter).toBe(false);
    });
  });

  describe('calculateEntryDelay', () => {
    it('should calculate delay in minutes', () => {
      const delay = calculateEntryDelay(1000, 2000);
      expect(delay).toBe(1000 / 60);
    });

    it('should return 0 for immediate entry', () => {
      const delay = calculateEntryDelay(1000, 1000);
      expect(delay).toBe(0);
    });
  });
});
