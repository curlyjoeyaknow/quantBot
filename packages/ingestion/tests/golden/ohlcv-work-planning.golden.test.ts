/**
 * Golden Path Tests for OHLCV Work Planning
 *
 * Tests the complete happy path for generating OHLCV worklists from DuckDB.
 * These tests validate the entire flow from DuckDB query to worklist generation.
 *
 * Golden Path:
 * 1. Query DuckDB for calls/tokens
 * 2. Group by mint and calculate time windows
 * 3. Create work items with correct priorities
 * 4. Sort by priority (call count)
 * 5. Return structured worklist
 *
 * Tests use mocked Python engine and validate worklist structure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DateTime } from 'luxon';
import { generateOhlcvWorklist } from '../../src/ohlcv-work-planning.js';
import { getPythonEngine } from '@quantbot/utils';
import type { OhlcvWorkItem } from '../../src/ohlcv-work-planning.js';
import { createTestDuckDB, cleanupTestDuckDB, createTempDuckDBPath } from '../helpers/createTestDuckDB.js';

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

describe('OHLCV Work Planning - Golden Path', () => {
  let mockPythonEngine: any;
  const TEST_DUCKDB_PATH = '/path/to/test.duckdb';
  const tempDbPaths: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();

    mockPythonEngine = {
      runOhlcvWorklist: vi.fn(),
    };

    vi.mocked(getPythonEngine).mockReturnValue(mockPythonEngine as any);
  });

  afterEach(() => {
    // Clean up temporary DuckDB files
    tempDbPaths.forEach((path) => {
      cleanupTestDuckDB(path);
    });
    tempDbPaths.length = 0;
  });

  describe('GOLDEN: Complete worklist generation flow', () => {
    it('should complete full golden path: DuckDB query → group → prioritize → sort → return worklist', async () => {
      // Setup: DuckDB returns realistic worklist data
      const mockWorklist = {
        tokenGroups: [
          {
            mint: '7pXs123456789012345678901234567890pump',
            chain: 'solana',
            earliestAlertTime: '2024-01-01T12:00:00Z',
            callCount: 10, // High priority
          },
          {
            mint: '8pXs123456789012345678901234567890pump',
            chain: 'solana',
            earliestAlertTime: '2024-01-01T14:00:00Z',
            callCount: 5, // Medium priority
          },
          {
            mint: '9pXs123456789012345678901234567890pump',
            chain: 'ethereum',
            earliestAlertTime: '2024-01-01T16:00:00Z',
            callCount: 1, // Low priority
          },
        ],
        calls: [
          {
            mint: '7pXs123456789012345678901234567890pump',
            alert_timestamp: '2024-01-01T12:00:00Z',
          },
          {
            mint: '7pXs123456789012345678901234567890pump',
            alert_timestamp: '2024-01-01T12:05:00Z',
          },
        ],
      };

      mockPythonEngine.runOhlcvWorklist.mockResolvedValue(mockWorklist);

      // Execute: Generate worklist
      const workItems = await generateOhlcvWorklist(TEST_DUCKDB_PATH, {
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        side: 'buy',
        chain: 'solana',
        interval: '1m',
        preWindowMinutes: 260,
        postWindowMinutes: 1440,
      });

      // Assert: Complete worklist structure
      expect(workItems).toHaveLength(3);

      // Assert: First item (highest priority)
      expect(workItems[0].mint).toBe('7pXs123456789012345678901234567890pump');
      expect(workItems[0].chain).toBe('solana');
      expect(workItems[0].interval).toBe('1m');
      expect(workItems[0].priority).toBe(10);
      expect(workItems[0].callCount).toBe(10);
      expect(workItems[0].alertTime).toBeDefined();

      // Assert: Time windows calculated correctly
      // Note: For '1m' interval, postWindow is automatically adjusted to 5000 - preWindow = 4740
      const alertTime1 = DateTime.fromISO('2024-01-01T12:00:00Z');
      expect(workItems[0].startTime.toISO()).toBe(alertTime1.minus({ minutes: 260 }).toISO());
      const expectedPostWindow = 5000 - 260; // Auto-adjusted for 1m interval
      expect(workItems[0].endTime.toISO()).toBe(
        alertTime1.plus({ minutes: expectedPostWindow }).toISO()
      );

      // Assert: Sorted by priority (descending)
      expect(workItems[0].priority).toBe(10);
      expect(workItems[1].priority).toBe(5);
      expect(workItems[2].priority).toBe(1);

      // Assert: Mint addresses preserved exactly
      expect(workItems[0].mint.length).toBeGreaterThanOrEqual(32); // Valid address length (32-44 chars)
      expect(workItems[0].mint).toBe('7pXs123456789012345678901234567890pump');
    });

    it('should handle large worklists (1000+ items) efficiently', async () => {
      // Setup: Generate large worklist
      const largeTokenGroups = [];
      for (let i = 0; i < 1000; i++) {
        largeTokenGroups.push({
          mint: `7pXs${String(i).padStart(40, '0')}pump`,
          chain: 'solana',
          earliestAlertTime: `2024-01-01T${String(i % 24).padStart(2, '0')}:00:00Z`,
          callCount: Math.floor(Math.random() * 100) + 1,
        });
      }

      mockPythonEngine.runOhlcvWorklist.mockResolvedValue({
        tokenGroups: largeTokenGroups,
        calls: [],
      });

      const workItems = await generateOhlcvWorklist(TEST_DUCKDB_PATH, {
        side: 'buy',
        chain: 'solana',
        interval: '1m',
      });

      // Assert: All items processed
      expect(workItems).toHaveLength(1000);

      // Assert: Sorted by priority
      for (let i = 0; i < workItems.length - 1; i++) {
        expect(workItems[i].priority!).toBeGreaterThanOrEqual(workItems[i + 1].priority!);
      }
    });

    it('should preserve mint address case exactly (critical for Solana)', async () => {
      const mixedCaseMint = '7pXsAbCdEfGhIjKlMnOpQrStUvWxYz1234567890';
      const mockWorklist = {
        tokenGroups: [
          {
            mint: mixedCaseMint,
            chain: 'solana',
            earliestAlertTime: '2024-01-01T12:00:00Z',
            callCount: 5,
          },
        ],
        calls: [],
      };

      mockPythonEngine.runOhlcvWorklist.mockResolvedValue(mockWorklist);

      const workItems = await generateOhlcvWorklist(TEST_DUCKDB_PATH);

      // Assert: Mint address preserved exactly
      expect(workItems[0].mint).toBe(mixedCaseMint);
      expect(workItems[0].mint).toMatch(/7pXsAbCdEfGhIjKlMnOpQrStUvWxYz/); // Exact case
      expect(workItems[0].mint.length).toBe(mixedCaseMint.length);
    });
  });

  describe('GOLDEN: Priority sorting - call count based', () => {
    it('should sort work items by call count (descending)', async () => {
      const mockWorklist = {
        tokenGroups: [
          { mint: 'low', chain: 'solana', earliestAlertTime: '2024-01-01T12:00:00Z', callCount: 1 },
          {
            mint: 'high',
            chain: 'solana',
            earliestAlertTime: '2024-01-01T12:00:00Z',
            callCount: 100,
          },
          {
            mint: 'medium',
            chain: 'solana',
            earliestAlertTime: '2024-01-01T12:00:00Z',
            callCount: 50,
          },
        ],
        calls: [],
      };

      mockPythonEngine.runOhlcvWorklist.mockResolvedValue(mockWorklist);

      const workItems = await generateOhlcvWorklist(TEST_DUCKDB_PATH);

      // Assert: Sorted by priority (call count) descending
      expect(workItems[0].mint).toBe('high');
      expect(workItems[0].priority).toBe(100);
      expect(workItems[1].mint).toBe('medium');
      expect(workItems[1].priority).toBe(50);
      expect(workItems[2].mint).toBe('low');
      expect(workItems[2].priority).toBe(1);
    });
  });

  describe('GOLDEN: Time window calculation', () => {
    it('should calculate correct time windows for all work items', async () => {
      const mockWorklist = {
        tokenGroups: [
          {
            mint: '7pXs123456789012345678901234567890pump',
            chain: 'solana',
            earliestAlertTime: '2024-01-01T12:00:00Z',
            callCount: 5,
          },
        ],
        calls: [],
      };

      mockPythonEngine.runOhlcvWorklist.mockResolvedValue(mockWorklist);

      const preWindow = 260; // 260 minutes before
      const postWindow = 1440; // 1440 minutes after
      const workItems = await generateOhlcvWorklist(TEST_DUCKDB_PATH, {
        preWindowMinutes: preWindow,
        postWindowMinutes: postWindow,
      });

      const alertTime = DateTime.fromISO('2024-01-01T12:00:00Z');
      const expectedStart = alertTime.minus({ minutes: preWindow });
      // Note: For '1m' interval, postWindow is automatically adjusted to 5000 - preWindow = 4740
      const expectedPostWindow = 5000 - preWindow; // Auto-adjusted for 1m interval
      const expectedEnd = alertTime.plus({ minutes: expectedPostWindow });

      // Assert: Time windows calculated correctly
      expect(workItems[0].startTime.toISO()).toBe(expectedStart.toISO());
      expect(workItems[0].endTime.toISO()).toBe(expectedEnd.toISO());
      expect(workItems[0].alertTime!.toISO()).toBe(alertTime.toISO());
    });
  });

  describe('GOLDEN: Chain detection and fallback', () => {
    it('should use chain from token group when available', async () => {
      const mockWorklist = {
        tokenGroups: [
          {
            mint: '7pXs123456789012345678901234567890pump',
            chain: 'ethereum', // Token group has chain
            earliestAlertTime: '2024-01-01T12:00:00Z',
            callCount: 5,
          },
        ],
        calls: [],
      };

      mockPythonEngine.runOhlcvWorklist.mockResolvedValue(mockWorklist);

      const workItems = await generateOhlcvWorklist(TEST_DUCKDB_PATH, {
        chain: 'solana', // Options chain (should be ignored)
      });

      expect(workItems[0].chain).toBe('ethereum'); // From token group
    });

    it('should fallback to options chain when token group has no chain', async () => {
      const mockWorklist = {
        tokenGroups: [
          {
            mint: '7pXs123456789012345678901234567890pump',
            // No chain in token group
            earliestAlertTime: '2024-01-01T12:00:00Z',
            callCount: 5,
          },
        ],
        calls: [],
      };

      mockPythonEngine.runOhlcvWorklist.mockResolvedValue(mockWorklist);

      const workItems = await generateOhlcvWorklist(TEST_DUCKDB_PATH, {
        chain: 'base', // Fallback chain
      });

      expect(workItems[0].chain).toBe('base'); // From options
    });
  });

  describe('GOLDEN: Error handling and validation', () => {
    it('should skip invalid token groups gracefully', async () => {
      const mockWorklist = {
        tokenGroups: [
          {
            mint: null, // Invalid: missing mint
            chain: 'solana',
            earliestAlertTime: '2024-01-01T12:00:00Z',
            callCount: 5,
          },
          {
            mint: '7pXs123456789012345678901234567890pump',
            chain: 'solana',
            // Invalid: missing earliestAlertTime
            callCount: 5,
          },
          {
            mint: '8pXs123456789012345678901234567890pump',
            chain: 'solana',
            earliestAlertTime: 'invalid-date', // Invalid: bad date
            callCount: 5,
          },
          {
            mint: '9pXs123456789012345678901234567890pump',
            chain: 'solana',
            earliestAlertTime: '2024-01-01T12:00:00Z',
            callCount: 5,
          },
        ],
        calls: [],
      };

      mockPythonEngine.runOhlcvWorklist.mockResolvedValue(mockWorklist);

      const workItems = await generateOhlcvWorklist(TEST_DUCKDB_PATH);

      // Assert: Only valid items included
      expect(workItems).toHaveLength(1);
      expect(workItems[0].mint).toBe('9pXs123456789012345678901234567890pump');
    });

    it('should filter worklist by specific mints when provided', async () => {
      const targetMints = [
        '8pXs123456789012345678901234567890pump',
        '9pXs123456789012345678901234567890pump',
      ];

      // Use temporary file path for real DuckDB creation
      const tempDbPath = createTempDuckDBPath('filter_mints_test');
      tempDbPaths.push(tempDbPath);

      // Create test data with multiple mints
      await createTestDuckDB(tempDbPath, [
        {
          mint: targetMints[0],
          chain: 'solana',
          triggerTsMs: DateTime.fromISO('2024-01-01T12:00:00Z').toMillis(),
        },
        {
          mint: targetMints[1],
          chain: 'solana',
          triggerTsMs: DateTime.fromISO('2024-01-01T14:00:00Z').toMillis(),
        },
        {
          mint: '7pXs123456789012345678901234567890pump', // Should be filtered out
          chain: 'solana',
          triggerTsMs: DateTime.fromISO('2024-01-01T16:00:00Z').toMillis(),
        },
      ]);

      // Mock Python engine to return data matching the DuckDB file
      mockPythonEngine.runOhlcvWorklist.mockResolvedValue({
        tokenGroups: [
          {
            mint: targetMints[0],
            chain: 'solana',
            earliestAlertTime: '2024-01-01T12:00:00Z',
            callCount: 1,
          },
          {
            mint: targetMints[1],
            chain: 'solana',
            earliestAlertTime: '2024-01-01T14:00:00Z',
            callCount: 1,
          },
          {
            mint: '7pXs123456789012345678901234567890pump',
            chain: 'solana',
            earliestAlertTime: '2024-01-01T16:00:00Z',
            callCount: 1,
          },
        ],
        calls: [],
      });

      const workItems = await generateOhlcvWorklist(tempDbPath, {
        mints: targetMints, // Filter by specific mints
      });

      // Should only return work items for the specified mints
      expect(workItems.length).toBeGreaterThanOrEqual(2);
      const workItemMints = workItems.map((w) => w.mint);
      targetMints.forEach((mint) => {
        expect(workItemMints).toContain(mint);
      });
      expect(workItemMints).not.toContain('7pXs123456789012345678901234567890pump');
    });

    it('should filter by mints combined with date range', async () => {
      const targetMint = '8pXs123456789012345678901234567890pump';
      const from = new Date('2024-01-01');
      const to = new Date('2024-01-02');

      // Use temporary file path for real DuckDB creation
      const tempDbPath = createTempDuckDBPath('filter_mints_date_test');
      tempDbPaths.push(tempDbPath);

      // Create test data with dates in and out of range
      await createTestDuckDB(tempDbPath, [
        {
          mint: targetMint,
          chain: 'solana',
          triggerTsMs: DateTime.fromISO('2024-01-01T12:00:00Z').toMillis(), // In range
        },
        {
          mint: targetMint,
          chain: 'solana',
          triggerTsMs: DateTime.fromISO('2024-01-03T12:00:00Z').toMillis(), // Out of range
        },
        {
          mint: 'otherMint',
          chain: 'solana',
          triggerTsMs: DateTime.fromISO('2024-01-01T12:00:00Z').toMillis(), // In range but different mint
        },
      ]);

      // Mock Python engine to return data matching the DuckDB file
      // Python engine handles date filtering, so mock should only return data within date range
      mockPythonEngine.runOhlcvWorklist.mockResolvedValue({
        tokenGroups: [
          {
            mint: targetMint,
            chain: 'solana',
            earliestAlertTime: '2024-01-01T12:00:00Z', // In range
            callCount: 1,
          },
          {
            mint: 'otherMint',
            chain: 'solana',
            earliestAlertTime: '2024-01-01T12:00:00Z', // In range (will be filtered out by mints)
            callCount: 1,
          },
          // Note: '2024-01-03T12:00:00Z' item is excluded because Python engine filters by date range
        ],
        calls: [],
      });

      const workItems = await generateOhlcvWorklist(tempDbPath, {
        from,
        to,
        mints: [targetMint], // Filter by mint AND date range
      });

      // Should only return work items for target mint within date range
      expect(workItems.length).toBeGreaterThan(0);
      workItems.forEach((item) => {
        expect(item.mint).toBe(targetMint);
        // Alert time should be within date range
        const alertTime = item.alertTime.toMillis();
        expect(alertTime).toBeGreaterThanOrEqual(from.getTime());
        expect(alertTime).toBeLessThanOrEqual(to.getTime() + 86400000); // Add 1 day margin
      });

      // Should not include other mint
      expect(workItems.map((w) => w.mint)).not.toContain('otherMint');
    });

    it('should preserve mint address case exactly when filtering', async () => {
      const mixedCaseMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

      // Use temporary file path for real DuckDB creation
      const tempDbPath = createTempDuckDBPath('filter_case_test');
      tempDbPaths.push(tempDbPath);

      await createTestDuckDB(tempDbPath, [
        {
          mint: mixedCaseMint, // Mixed case
          chain: 'solana',
          triggerTsMs: DateTime.fromISO('2024-01-01T12:00:00Z').toMillis(),
        },
      ]);

      // Mock Python engine to return data matching the DuckDB file (preserve exact case)
      mockPythonEngine.runOhlcvWorklist.mockResolvedValue({
        tokenGroups: [
          {
            mint: mixedCaseMint, // Exact case preserved
            chain: 'solana',
            earliestAlertTime: '2024-01-01T12:00:00Z',
            callCount: 1,
          },
        ],
        calls: [],
      });

      const workItems = await generateOhlcvWorklist(tempDbPath, {
        mints: [mixedCaseMint], // Pass exact case
      });

      // Should preserve exact case
      expect(workItems.length).toBeGreaterThan(0);
      expect(workItems[0].mint).toBe(mixedCaseMint);
      expect(workItems[0].mint).not.toBe(mixedCaseMint.toLowerCase());
      expect(workItems[0].mint).not.toBe(mixedCaseMint.toUpperCase());
    });

    it('should handle Python engine errors gracefully', async () => {
      mockPythonEngine.runOhlcvWorklist.mockRejectedValue(new Error('DuckDB connection failed'));

      await expect(generateOhlcvWorklist(TEST_DUCKDB_PATH)).rejects.toThrow(
        'DuckDB connection failed'
      );
    });
  });

  describe('GOLDEN: Default values and options', () => {
    it('should use default values when options not provided', async () => {
      const mockWorklist = {
        tokenGroups: [
          {
            mint: '7pXs123456789012345678901234567890pump',
            chain: 'solana',
            earliestAlertTime: '2024-01-01T12:00:00Z',
            callCount: 5,
          },
        ],
        calls: [],
      };

      mockPythonEngine.runOhlcvWorklist.mockResolvedValue(mockWorklist);

      const workItems = await generateOhlcvWorklist(TEST_DUCKDB_PATH);

      // Assert: Defaults applied
      expect(workItems[0].interval).toBe('1m'); // Default
      expect(workItems[0].chain).toBe('solana'); // Default

      // Assert: Default windows (260 pre, 1440 post)
      const alertTime = DateTime.fromISO('2024-01-01T12:00:00Z');
      expect(workItems[0].startTime.toISO()).toBe(alertTime.minus({ minutes: 260 }).toISO());
      // Note: For '1m' interval, postWindow is automatically adjusted to 5000 - preWindow = 4740
      const expectedPostWindow = 5000 - 260; // Auto-adjusted for 1m interval
      expect(workItems[0].endTime.toISO()).toBe(
        alertTime.plus({ minutes: expectedPostWindow }).toISO()
      );
    });
  });
});
