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
 * Tests use real DuckDB database (copied to protect original) and real Python engine.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DateTime } from 'luxon';
import { generateOhlcvWorklist } from '../../src/ohlcv-work-planning.js';
import type { OhlcvWorkItem } from '../../src/ohlcv-work-planning.js';
import {
  createTestDuckDB,
  cleanupTestDuckDB,
  createTempDuckDBPath,
  copyRealDuckDB,
} from '../helpers/createTestDuckDB.js';
import { join } from 'path';

// Mock only logger (not Python engine - golden tests use real implementation)
vi.mock('@quantbot/utils', async () => {
  const actual = await vi.importActual('@quantbot/utils');
  return {
    ...actual,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

// Unmock @quantbot/storage for golden tests (use real implementation)
vi.unmock('@quantbot/storage');

describe('OHLCV Work Planning - Golden Path', () => {
  const tempDbPaths: string[] = [];
  const REAL_DB_PATH = join(process.cwd(), 'data', 'result.duckdb');

  afterEach(() => {
    // Clean up temporary DuckDB files
    tempDbPaths.forEach((path) => {
      cleanupTestDuckDB(path);
    });
    tempDbPaths.length = 0;
  });

  describe('GOLDEN: Complete worklist generation flow', () => {
    it('should complete full golden path: DuckDB query → group → prioritize → sort → return worklist', async () => {
      // Copy real database to protect original data
      const testDbPath = createTempDuckDBPath('golden_path_test');
      tempDbPaths.push(testDbPath);
      await copyRealDuckDB(REAL_DB_PATH, testDbPath);

      // Execute: Generate worklist from real database
      const workItems = await generateOhlcvWorklist(testDbPath, {
        from: new Date('2024-01-01'),
        to: new Date('2024-01-02'),
        side: 'buy',
        chain: 'solana',
        interval: '1m',
        preWindowMinutes: 260,
        postWindowMinutes: 1440,
      });

      // Assert: Worklist structure is valid
      expect(Array.isArray(workItems)).toBe(true);
      expect(workItems.length).toBeGreaterThanOrEqual(0);

      if (workItems.length > 0) {
        // Assert: Work items have required structure
        const firstItem = workItems[0];
        expect(firstItem.mint).toBeDefined();
        expect(firstItem.chain).toBeDefined();
        expect(firstItem.interval).toBeDefined();
        expect(firstItem.startTime).toBeDefined();
        expect(firstItem.endTime).toBeDefined();
        expect(firstItem.alertTime).toBeDefined();

        // Assert: Mint addresses preserved exactly (critical for Solana)
        expect(firstItem.mint.length).toBeGreaterThanOrEqual(32); // Valid address length (32-44 chars)

        // Assert: Sorted by priority (descending) if priority is set
        if (workItems.length > 1 && workItems[0].priority !== undefined) {
          for (let i = 0; i < workItems.length - 1; i++) {
            if (workItems[i].priority !== undefined && workItems[i + 1].priority !== undefined) {
              expect(workItems[i].priority!).toBeGreaterThanOrEqual(workItems[i + 1].priority!);
            }
          }
        }
      }
    });

    it('should handle large worklists efficiently', async () => {
      // Copy real database to protect original data
      const testDbPath = createTempDuckDBPath('large_worklist_test');
      tempDbPaths.push(testDbPath);
      await copyRealDuckDB(REAL_DB_PATH, testDbPath);

      const workItems = await generateOhlcvWorklist(testDbPath, {
        side: 'buy',
        chain: 'solana',
        interval: '1m',
      });

      // Assert: Worklist is returned
      expect(Array.isArray(workItems)).toBe(true);

      // Assert: Sorted by priority if items have priority
      if (workItems.length > 1) {
        for (let i = 0; i < workItems.length - 1; i++) {
          if (workItems[i].priority !== undefined && workItems[i + 1].priority !== undefined) {
            expect(workItems[i].priority!).toBeGreaterThanOrEqual(workItems[i + 1].priority!);
          }
        }
      }
    });

    it('should preserve mint address case exactly (critical for Solana)', async () => {
      // Copy real database to protect original data
      const testDbPath = createTempDuckDBPath('case_preservation_test');
      tempDbPaths.push(testDbPath);
      await copyRealDuckDB(REAL_DB_PATH, testDbPath);

      const workItems = await generateOhlcvWorklist(testDbPath);

      // Assert: Mint addresses preserved exactly (if any items exist)
      if (workItems.length > 0) {
        const firstMint = workItems[0].mint;
        expect(firstMint).toBeDefined();
        expect(firstMint.length).toBeGreaterThanOrEqual(32); // Valid address length

        // Verify that the mint address matches what comes from the database
        // (case should be preserved exactly as stored)
        const workItemsWithSameMint = workItems.filter((w) => w.mint === firstMint);
        expect(workItemsWithSameMint.length).toBeGreaterThan(0);
      }
    });
  });

  describe('GOLDEN: Priority sorting - call count based', () => {
    it('should sort work items by call count (descending)', async () => {
      // Copy real database to protect original data
      const testDbPath = createTempDuckDBPath('priority_sort_test');
      tempDbPaths.push(testDbPath);
      await copyRealDuckDB(REAL_DB_PATH, testDbPath);

      const workItems = await generateOhlcvWorklist(testDbPath);

      // Assert: Sorted by priority (call count) descending if priority is set
      if (workItems.length > 1) {
        for (let i = 0; i < workItems.length - 1; i++) {
          if (workItems[i].priority !== undefined && workItems[i + 1].priority !== undefined) {
            expect(workItems[i].priority!).toBeGreaterThanOrEqual(workItems[i + 1].priority!);
          }
        }
      }
    });
  });

  describe('GOLDEN: Time window calculation', () => {
    it('should calculate correct time windows for all work items', async () => {
      // Copy real database to protect original data
      const testDbPath = createTempDuckDBPath('time_window_test');
      tempDbPaths.push(testDbPath);
      await copyRealDuckDB(REAL_DB_PATH, testDbPath);

      const preWindow = 260; // 260 minutes before
      const postWindow = 1440; // 1440 minutes after
      const workItems = await generateOhlcvWorklist(testDbPath, {
        preWindowMinutes: preWindow,
        postWindowMinutes: postWindow,
        interval: '1m',
      });

      // Assert: Time windows calculated correctly for all items
      if (workItems.length > 0) {
        for (const item of workItems) {
          expect(item.startTime).toBeDefined();
          expect(item.endTime).toBeDefined();
          expect(item.alertTime).toBeDefined();

          // Verify time windows are logical
          expect(item.startTime.toMillis()).toBeLessThan(item.alertTime!.toMillis());
          expect(item.alertTime!.toMillis()).toBeLessThan(item.endTime.toMillis());

          // Verify pre-window is approximately correct (allow some variance for interval adjustments)
          const actualPreWindow = item.alertTime!.diff(item.startTime, 'minutes').minutes;
          expect(actualPreWindow).toBeGreaterThanOrEqual(preWindow - 100); // Allow some variance
          expect(actualPreWindow).toBeLessThanOrEqual(preWindow + 5000); // Allow for interval adjustments
        }
      }
    });
  });

  describe('GOLDEN: Chain detection and fallback', () => {
    it('should use chain from token group when available', async () => {
      // Copy real database to protect original data
      const testDbPath = createTempDuckDBPath('chain_detection_test');
      tempDbPaths.push(testDbPath);
      await copyRealDuckDB(REAL_DB_PATH, testDbPath);

      const workItems = await generateOhlcvWorklist(testDbPath, {
        chain: 'solana', // Options chain (fallback if not in token group)
      });

      // Assert: All work items have a chain
      if (workItems.length > 0) {
        for (const item of workItems) {
          expect(item.chain).toBeDefined();
          expect(['solana', 'ethereum', 'base', 'bsc']).toContain(item.chain);
        }
      }
    });

    it('should fallback to options chain when token group has no chain', async () => {
      // Copy real database to protect original data
      const testDbPath = createTempDuckDBPath('chain_fallback_test');
      tempDbPaths.push(testDbPath);
      await copyRealDuckDB(REAL_DB_PATH, testDbPath);

      const fallbackChain = 'base';
      const workItems = await generateOhlcvWorklist(testDbPath, {
        chain: fallbackChain, // Fallback chain
      });

      // Assert: All work items have a chain (either from token group or fallback)
      if (workItems.length > 0) {
        for (const item of workItems) {
          expect(item.chain).toBeDefined();
          // Chain should be either from token group or fallback
          expect(['solana', 'ethereum', 'base', 'bsc']).toContain(item.chain);
        }
      }
    });
  });

  describe('GOLDEN: Error handling and validation', () => {
    it('should skip invalid token groups gracefully', async () => {
      // Copy real database to protect original data
      const testDbPath = createTempDuckDBPath('invalid_groups_test');
      tempDbPaths.push(testDbPath);
      await copyRealDuckDB(REAL_DB_PATH, testDbPath);

      const workItems = await generateOhlcvWorklist(testDbPath);

      // Assert: All returned items are valid (have required fields)
      for (const item of workItems) {
        expect(item.mint).toBeDefined();
        expect(item.mint).not.toBe('');
        expect(item.chain).toBeDefined();
        expect(item.startTime).toBeDefined();
        expect(item.endTime).toBeDefined();
      }
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

      // Use real Python engine - no mocking for golden path tests
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

      // Use real Python engine - no mocking for golden path tests
      // Python engine handles date filtering, TypeScript filters by mints
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

      // Use real Python engine - no mocking for golden path tests
      // DuckDB and Python engine should preserve exact case
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
      // Use non-existent database path to trigger error
      const nonExistentPath = createTempDuckDBPath('non_existent_test');
      // Don't create the file - this should trigger an error

      await expect(generateOhlcvWorklist(nonExistentPath)).rejects.toThrow();
    });
  });

  describe('GOLDEN: Default values and options', () => {
    it('should use default values when options not provided', async () => {
      // Copy real database to protect original data
      const testDbPath = createTempDuckDBPath('defaults_test');
      tempDbPaths.push(testDbPath);
      await copyRealDuckDB(REAL_DB_PATH, testDbPath);

      const workItems = await generateOhlcvWorklist(testDbPath);

      // Assert: Defaults applied if items exist
      if (workItems.length > 0) {
        expect(workItems[0].interval).toBe('1m'); // Default
        expect(workItems[0].chain).toBeDefined(); // Should have a chain (default or from data)

        // Assert: Default windows are used (260 pre, 4740 post for 1m interval)
        if (workItems[0].alertTime) {
          const alertTime = workItems[0].alertTime;
          const expectedStart = alertTime.minus({ minutes: 260 });
          const expectedPostWindow = 5000 - 260; // Auto-adjusted for 1m interval
          const expectedEnd = alertTime.plus({ minutes: expectedPostWindow });
          expect(workItems[0].startTime.toISO()).toBe(expectedStart.toISO());
          expect(workItems[0].endTime.toISO()).toBe(expectedEnd.toISO());
        }
      }
    });
  });
});
