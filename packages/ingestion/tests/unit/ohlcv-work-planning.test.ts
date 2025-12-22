/**
 * Unit tests for OHLCV Work Planning
 *
 * Tests cover:
 * - Worklist generation from DuckDB
 * - Work item creation with correct time windows
 * - Priority sorting by call count
 * - Chain detection
 * - Interval handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { generateOhlcvWorklist } from '../../src/ohlcv-work-planning.js';
import { getPythonEngine } from '@quantbot/utils';
import type { OhlcvWorkItem } from '../../src/ohlcv-work-planning.js';

// Mock dependencies
vi.mock('@quantbot/utils', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  getPythonEngine: vi.fn(),
}));

describe('OHLCV Work Planning', () => {
  let mockPythonEngine: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPythonEngine = {
      runOhlcvWorklist: vi.fn(),
    };

    vi.mocked(getPythonEngine).mockReturnValue(mockPythonEngine as any);
  });

  describe('generateOhlcvWorklist', () => {
    it('should generate worklist from DuckDB query', async () => {
      const duckdbPath = '/path/to/duckdb';
      const from = new Date('2024-01-01');
      const to = new Date('2024-01-02');

      const mockWorklist = {
        tokenGroups: [
          {
            mint: '7pXs123456789012345678901234567890pump',
            chain: 'solana',
            earliestAlertTime: '2024-01-01T12:00:00Z',
            callCount: 5,
          },
          {
            mint: '8pXs123456789012345678901234567890pump',
            chain: 'solana',
            earliestAlertTime: '2024-01-01T14:00:00Z',
            callCount: 3,
          },
        ],
        calls: [
          {
            mint: '7pXs123456789012345678901234567890pump',
            alert_timestamp: '2024-01-01T12:00:00Z',
          },
        ],
      };

      mockPythonEngine.runOhlcvWorklist.mockResolvedValue(mockWorklist);

      const workItems = await generateOhlcvWorklist(duckdbPath, {
        from,
        to,
        side: 'buy',
        chain: 'solana',
        interval: '1m',
        preWindowMinutes: 260,
        postWindowMinutes: 1440,
      });

      expect(workItems).toHaveLength(2);
      expect(workItems[0].mint).toBe('7pXs123456789012345678901234567890pump');
      expect(workItems[0].chain).toBe('solana');
      expect(workItems[0].interval).toBe('1m');
      expect(workItems[0].callCount).toBe(5);
      expect(workItems[0].priority).toBe(5); // Higher call count = higher priority

      // Verify time windows
      // Note: For '1m' interval, postWindow is automatically adjusted to 5000 - preWindow = 4740
      const alertTime = DateTime.fromISO('2024-01-01T12:00:00Z');
      expect(workItems[0].startTime.toISO()).toBe(alertTime.minus({ minutes: 260 }).toISO());
      const expectedPostWindow = 5000 - 260; // Auto-adjusted for 1m interval
      expect(workItems[0].endTime.toISO()).toBe(
        alertTime.plus({ minutes: expectedPostWindow }).toISO()
      );
    });

    it('should sort work items by priority (call count)', async () => {
      const mockWorklist = {
        tokenGroups: [
          {
            mint: 'lowPriority',
            chain: 'solana',
            earliestAlertTime: '2024-01-01T12:00:00Z',
            callCount: 1,
          },
          {
            mint: 'highPriority',
            chain: 'solana',
            earliestAlertTime: '2024-01-01T12:00:00Z',
            callCount: 10,
          },
          {
            mint: 'mediumPriority',
            chain: 'solana',
            earliestAlertTime: '2024-01-01T12:00:00Z',
            callCount: 5,
          },
        ],
        calls: [],
      };

      mockPythonEngine.runOhlcvWorklist.mockResolvedValue(mockWorklist);

      const workItems = await generateOhlcvWorklist('/path/to/duckdb', {
        side: 'buy',
        chain: 'solana',
        interval: '1m',
      });

      expect(workItems).toHaveLength(3);
      // Should be sorted by priority (call count) descending
      expect(workItems[0].mint).toBe('highPriority');
      expect(workItems[0].priority).toBe(10);
      expect(workItems[1].mint).toBe('mediumPriority');
      expect(workItems[1].priority).toBe(5);
      expect(workItems[2].mint).toBe('lowPriority');
      expect(workItems[2].priority).toBe(1);
    });

    it('should use default values when options not provided', async () => {
      const mockWorklist = {
        tokenGroups: [
          {
            mint: '7pXs123456789012345678901234567890pump',
            chain: 'solana',
            earliestAlertTime: '2024-01-01T12:00:00Z',
            callCount: 1,
          },
        ],
        calls: [],
      };

      mockPythonEngine.runOhlcvWorklist.mockResolvedValue(mockWorklist);

      const workItems = await generateOhlcvWorklist('/path/to/duckdb');

      expect(workItems).toHaveLength(1);
      expect(workItems[0].interval).toBe('1m'); // Default
      expect(workItems[0].chain).toBe('solana'); // Default

      // Default windows: 260 pre, auto-adjusted post for 1m interval (5000 - 260 = 4740)
      const alertTime = DateTime.fromISO('2024-01-01T12:00:00Z');
      expect(workItems[0].startTime.toISO()).toBe(alertTime.minus({ minutes: 260 }).toISO());
      // Note: For '1m' interval, postWindow is automatically adjusted to 5000 - preWindow = 4740
      const expectedPostWindow = 5000 - 260; // Auto-adjusted for 1m interval
      expect(workItems[0].endTime.toISO()).toBe(
        alertTime.plus({ minutes: expectedPostWindow }).toISO()
      );
    });

    it('should handle missing required fields gracefully', async () => {
      const mockWorklist = {
        tokenGroups: [
          {
            mint: null, // Missing mint
            chain: 'solana',
            earliestAlertTime: '2024-01-01T12:00:00Z',
            callCount: 1,
          },
          {
            mint: '7pXs123456789012345678901234567890pump',
            chain: 'solana',
            // Missing earliestAlertTime
            callCount: 1,
          },
          {
            mint: '8pXs123456789012345678901234567890pump',
            chain: 'solana',
            earliestAlertTime: '2024-01-01T12:00:00Z',
            callCount: 1,
          },
        ],
        calls: [],
      };

      mockPythonEngine.runOhlcvWorklist.mockResolvedValue(mockWorklist);

      const workItems = await generateOhlcvWorklist('/path/to/duckdb');

      // Should skip invalid items and only include valid ones
      expect(workItems).toHaveLength(1);
      expect(workItems[0].mint).toBe('8pXs123456789012345678901234567890pump');
    });

    it('should handle invalid alert times gracefully', async () => {
      const mockWorklist = {
        tokenGroups: [
          {
            mint: '7pXs123456789012345678901234567890pump',
            chain: 'solana',
            earliestAlertTime: 'invalid-date',
            callCount: 1,
          },
          {
            mint: '8pXs123456789012345678901234567890pump',
            chain: 'solana',
            earliestAlertTime: '2024-01-01T12:00:00Z',
            callCount: 1,
          },
        ],
        calls: [],
      };

      mockPythonEngine.runOhlcvWorklist.mockResolvedValue(mockWorklist);

      const workItems = await generateOhlcvWorklist('/path/to/duckdb');

      // Should skip invalid dates and only include valid ones
      expect(workItems).toHaveLength(1);
      expect(workItems[0].mint).toBe('8pXs123456789012345678901234567890pump');
    });

    it('should use chain from token group or fallback to options', async () => {
      const mockWorklist = {
        tokenGroups: [
          {
            mint: '7pXs123456789012345678901234567890pump',
            chain: 'ethereum', // Token group has chain
            earliestAlertTime: '2024-01-01T12:00:00Z',
            callCount: 1,
          },
          {
            mint: '8pXs123456789012345678901234567890pump',
            // No chain in token group
            earliestAlertTime: '2024-01-01T12:00:00Z',
            callCount: 1,
          },
        ],
        calls: [],
      };

      mockPythonEngine.runOhlcvWorklist.mockResolvedValue(mockWorklist);

      const workItems = await generateOhlcvWorklist('/path/to/duckdb', {
        chain: 'base', // Fallback chain
      });

      expect(workItems[0].chain).toBe('ethereum'); // From token group
      expect(workItems[1].chain).toBe('base'); // From options fallback
    });

    it('should pass correct parameters to Python engine', async () => {
      const duckdbPath = '/path/to/duckdb';
      const from = new Date('2024-01-01');
      const to = new Date('2024-01-02');

      mockPythonEngine.runOhlcvWorklist.mockResolvedValue({
        tokenGroups: [],
        calls: [],
      });

      await generateOhlcvWorklist(duckdbPath, {
        from,
        to,
        side: 'sell',
        chain: 'ethereum',
      });

      expect(mockPythonEngine.runOhlcvWorklist).toHaveBeenCalledWith({
        duckdbPath,
        from: from.toISOString(),
        to: to.toISOString(),
        side: 'sell',
      });
    });

    it('should filter worklist by specific mints when provided', async () => {
      const duckdbPath = '/path/to/duckdb';
      const targetMints = [
        '7pXs123456789012345678901234567890pump',
        '8pXs123456789012345678901234567890pump',
      ];
      const otherMint = '9pXs123456789012345678901234567890pump';

      const mockWorklist = {
        tokenGroups: [
          {
            mint: targetMints[0],
            chain: 'solana',
            earliestAlertTime: '2024-01-01T12:00:00Z',
            callCount: 5,
          },
          {
            mint: targetMints[1],
            chain: 'solana',
            earliestAlertTime: '2024-01-01T14:00:00Z',
            callCount: 3,
          },
          {
            mint: otherMint, // Should be filtered out
            chain: 'solana',
            earliestAlertTime: '2024-01-01T16:00:00Z',
            callCount: 2,
          },
        ],
        calls: [],
      };

      mockPythonEngine.runOhlcvWorklist.mockResolvedValue(mockWorklist);

      const workItems = await generateOhlcvWorklist(duckdbPath, {
        mints: targetMints,
      });

      // Should only return work items for the specified mints (filtering happens in TypeScript)
      expect(workItems).toHaveLength(2);
      expect(workItems.map((w) => w.mint)).toEqual(targetMints);
      expect(workItems.map((w) => w.mint)).not.toContain(otherMint);

      // Verify Python engine was called WITHOUT mints (filtering happens in TypeScript)
      expect(mockPythonEngine.runOhlcvWorklist).toHaveBeenCalledWith(
        expect.objectContaining({
          duckdbPath: expect.stringContaining('duckdb'),
        })
      );
      expect(mockPythonEngine.runOhlcvWorklist).not.toHaveBeenCalledWith(
        expect.objectContaining({ mints: expect.anything() })
      );
    });

    it('should handle empty mint filter (return all mints)', async () => {
      const mockWorklist = {
        tokenGroups: [
          {
            mint: 'mint1',
            chain: 'solana',
            earliestAlertTime: '2024-01-01T12:00:00Z',
            callCount: 1,
          },
          {
            mint: 'mint2',
            chain: 'solana',
            earliestAlertTime: '2024-01-01T14:00:00Z',
            callCount: 1,
          },
        ],
        calls: [],
      };

      mockPythonEngine.runOhlcvWorklist.mockResolvedValue(mockWorklist);

      const workItems = await generateOhlcvWorklist('/path/to/duckdb', {
        mints: [], // Empty array = no filter
      });

      // Should return all work items when mints array is empty (empty array = no filter)
      expect(workItems).toHaveLength(2);
      // Python engine should be called without mints parameter (empty array means no filter)
      expect(mockPythonEngine.runOhlcvWorklist).toHaveBeenCalledWith(
        expect.objectContaining({
          duckdbPath: expect.stringContaining('duckdb'),
        })
      );
      expect(mockPythonEngine.runOhlcvWorklist).not.toHaveBeenCalledWith(
        expect.objectContaining({ mints: expect.anything() })
      );
    });

    it('should handle undefined mints (no filter)', async () => {
      const mockWorklist = {
        tokenGroups: [
          {
            mint: 'mint1',
            chain: 'solana',
            earliestAlertTime: '2024-01-01T12:00:00Z',
            callCount: 1,
          },
        ],
        calls: [],
      };

      mockPythonEngine.runOhlcvWorklist.mockResolvedValue(mockWorklist);

      const workItems = await generateOhlcvWorklist('/path/to/duckdb', {});

      // Should return all work items when mints is undefined
      expect(workItems).toHaveLength(1);
      expect(mockPythonEngine.runOhlcvWorklist).toHaveBeenCalledWith({
        duckdbPath: '/path/to/duckdb',
      });
      expect(mockPythonEngine.runOhlcvWorklist).not.toHaveBeenCalledWith(
        expect.objectContaining({ mints: expect.anything() })
      );
    });

    it('should preserve mint address case exactly when filtering', async () => {
      const mixedCaseMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const lowerCaseMint = mixedCaseMint.toLowerCase();
      const upperCaseMint = mixedCaseMint.toUpperCase();

      const mockWorklist = {
        tokenGroups: [
          {
            mint: mixedCaseMint, // Mixed case
            chain: 'solana',
            earliestAlertTime: '2024-01-01T12:00:00Z',
            callCount: 1,
          },
        ],
        calls: [],
      };

      mockPythonEngine.runOhlcvWorklist.mockResolvedValue(mockWorklist);

      const workItems = await generateOhlcvWorklist('/path/to/duckdb', {
        mints: [mixedCaseMint], // Pass exact case
      });

      // Should preserve exact case (filtering happens in TypeScript with exact case match)
      expect(workItems).toHaveLength(1);
      expect(workItems[0].mint).toBe(mixedCaseMint);
      expect(workItems[0].mint).not.toBe(lowerCaseMint);
      expect(workItems[0].mint).not.toBe(upperCaseMint);

      // Verify Python engine was called without mints (filtering happens in TypeScript)
      expect(mockPythonEngine.runOhlcvWorklist).toHaveBeenCalledWith(
        expect.objectContaining({
          duckdbPath: expect.stringContaining('duckdb'),
        })
      );
      expect(mockPythonEngine.runOhlcvWorklist).not.toHaveBeenCalledWith(
        expect.objectContaining({ mints: expect.anything() })
      );
    });
  });
});
