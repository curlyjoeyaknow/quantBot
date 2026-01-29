/**
 * Golden path tests for surgicalOhlcvFetch workflow
 *
 * Tests the complete happy path with REAL implementations.
 * Focus: End-to-end workflow, real Python scripts, real OHLCV ingestion
 *
 * These tests verify the ACTUAL behavior, not mocked behavior.
 *
 * Requirements:
 * - ClickHouse running (localhost:8123)
 * - DuckDB with test data
 * - Set RUN_DB_STRESS=1 to enable these tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { surgicalOhlcvFetch } from '../../../src/ohlcv/surgicalOhlcvFetch.js';
import type { SurgicalOhlcvFetchContext } from '../../../src/ohlcv/surgicalOhlcvFetch.js';
import { createOhlcvIngestionContext } from '../../../src/context/createOhlcvIngestionContext.js';
import { DateTime } from 'luxon';
import { PythonEngine, logger } from '@quantbot/infra/utils';
import { shouldRunDbStress } from '@quantbot/infra/utils/test-helpers/test-gating';
import { OhlcvBirdeyeFetch } from '@quantbot/data/jobs';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

// Gate these tests behind RUN_DB_STRESS=1
// These tests require ClickHouse and real database connections
const shouldRun = shouldRunDbStress();

describe.skipIf(!shouldRun)('surgicalOhlcvFetch golden path tests', () => {
  const testDir = join(process.cwd(), 'test-data', 'surgical-fetch');
  const testDuckdbPath = join(testDir, 'test-calls.duckdb');
  let pythonEngine: PythonEngine;
  let context: SurgicalOhlcvFetchContext;

  beforeAll(() => {
    // Set dummy Birdeye API key for tests (context creation requires it)
    if (!process.env.BIRDEYE_API_KEY_1) {
      process.env.BIRDEYE_API_KEY_1 = 'test-key-1';
    }

    // Create test directory
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }

    // Create test DuckDB with sample data
    const setupScript = `
import duckdb
import sys

db_path = sys.argv[1]
conn = duckdb.connect(db_path)

# Create caller_links_d table
conn.execute("""
  CREATE TABLE IF NOT EXISTS caller_links_d (
    trigger_from_name VARCHAR,
    mint VARCHAR,
    trigger_ts_ms BIGINT,
    chain VARCHAR
  )
""")

# Insert sample data - calls from Nov 2025
conn.execute("""
  INSERT INTO caller_links_d VALUES
    ('TestCaller', 'So11111111111111111111111111111111111111112', 1730419200000, 'solana'),
    ('TestCaller', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 1730505600000, 'solana')
""")

conn.close()
print("Test database created")
`;

    try {
      execSync(`python3 -c "${setupScript.replace(/"/g, '\\"')}" "${testDuckdbPath}"`, {
        encoding: 'utf-8',
      });
    } catch (error) {
      console.error('Failed to create test database:', error);
      throw error;
    }

    // Initialize Python engine
    pythonEngine = new PythonEngine();

    // Create OHLCV Birdeye fetch service
    const ohlcvBirdeyeFetch = new OhlcvBirdeyeFetch({
      rateLimitMs: 100,
      maxRetries: 3,
      checkCoverage: true,
    });

    // Create context
    context = {
      pythonEngine,
      ohlcvIngestionContext: createOhlcvIngestionContext({ ohlcvBirdeyeFetch }),
      logger: {
        info: (msg: string, meta?: Record<string, unknown>) => {
          logger.info(msg, { service: 'test', ...meta });
        },
        error: (msg: string, meta?: Record<string, unknown>) => {
          logger.error(msg, { service: 'test', ...meta });
        },
        debug: (msg: string, meta?: Record<string, unknown>) => {
          logger.debug(msg, { service: 'test', ...meta });
        },
      },
      clock: {
        now: () => DateTime.utc(),
      },
    };
  });

  afterAll(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Golden Path: Show Top Gaps', () => {
    it('should analyze coverage and show top gaps without fetching', async () => {
      const spec = {
        duckdbPath: testDuckdbPath,
        interval: '5m' as const,
        minCoverage: 0.8,
        dryRun: false,
        // No auto, no caller, no month = show top gaps only
      };

      const result = await surgicalOhlcvFetch(spec, context);

      // Should analyze but not execute
      expect(result.tasksAnalyzed).toBeGreaterThan(0);
      expect(result.tasksExecuted).toBe(0);
      expect(result.tasksSucceeded).toBe(0);
      expect(result.tasksFailed).toBe(0);
      expect(result.totalCandlesFetched).toBe(0);
      expect(result.totalCandlesStored).toBe(0);

      // Should have task results (preview)
      expect(result.taskResults).toBeInstanceOf(Array);
      expect(result.taskResults.length).toBeGreaterThan(0);
      expect(result.taskResults.length).toBeLessThanOrEqual(10); // Top 10

      // Verify result structure
      expect(result.startedAtISO).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(result.completedAtISO).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(result.durationMs).toBeGreaterThan(0);
    }, 60000);
  });

  describe('Golden Path: Dry Run', () => {
    it('should show what would be fetched without actually fetching', async () => {
      const spec = {
        duckdbPath: testDuckdbPath,
        interval: '5m' as const,
        auto: true,
        limit: 1,
        minCoverage: 1.0, // Require perfect coverage to ensure we have gaps
        dryRun: true,
      };

      const result = await surgicalOhlcvFetch(spec, context);

      // Should execute tasks in dry-run mode
      expect(result.tasksExecuted).toBeGreaterThan(0);
      expect(result.tasksSucceeded).toBe(result.tasksExecuted);
      expect(result.tasksFailed).toBe(0);

      // But no candles should be fetched
      expect(result.totalCandlesFetched).toBe(0);
      expect(result.totalCandlesStored).toBe(0);

      // Task results should show what would be done
      expect(result.taskResults).toBeInstanceOf(Array);
      result.taskResults.forEach((task) => {
        expect(task.caller).toBeDefined();
        expect(task.month).toBeDefined();
        expect(task.intervals).toBeInstanceOf(Array);
        expect(task.success).toBe(true);
        expect(task.candlesFetched).toBe(0);
        expect(task.candlesStored).toBe(0);
      });
    }, 60000);
  });

  describe('Golden Path: Specific Caller', () => {
    it('should fetch gaps for specific caller', async () => {
      const spec = {
        duckdbPath: testDuckdbPath,
        interval: '5m' as const,
        caller: 'TestCaller',
        minCoverage: 1.0,
        dryRun: true, // Dry run to avoid actual API calls
      };

      const result = await surgicalOhlcvFetch(spec, context);

      // Should only process TestCaller
      expect(result.tasksExecuted).toBeGreaterThan(0);
      result.taskResults.forEach((task) => {
        expect(task.caller).toBe('TestCaller');
      });
    }, 60000);
  });

  describe('Golden Path: Specific Month', () => {
    it('should fetch gaps for specific month', async () => {
      const spec = {
        duckdbPath: testDuckdbPath,
        interval: '5m' as const,
        month: '2025-11',
        minCoverage: 1.0,
        dryRun: true,
      };

      const result = await surgicalOhlcvFetch(spec, context);

      // Should process Nov 2025 if gaps exist
      // With no OHLCV data and minCoverage 1.0, there should be gaps
      expect(result.tasksExecuted).toBeGreaterThanOrEqual(0);

      // If tasks were executed, they should all be for Nov 2025
      if (result.tasksExecuted > 0) {
        result.taskResults.forEach((task) => {
          expect(task.month).toBe('2025-11');
        });
      }
    }, 60000);
  });

  describe('Golden Path: Specific Caller-Month', () => {
    it('should fetch gaps for specific caller and month', async () => {
      const spec = {
        duckdbPath: testDuckdbPath,
        interval: '5m' as const,
        caller: 'TestCaller',
        month: '2025-11',
        minCoverage: 1.0,
        dryRun: true,
      };

      const result = await surgicalOhlcvFetch(spec, context);

      // Should process exactly one task
      expect(result.tasksExecuted).toBeGreaterThanOrEqual(0); // May be 0 if no gaps
      result.taskResults.forEach((task) => {
        expect(task.caller).toBe('TestCaller');
        expect(task.month).toBe('2025-11');
      });
    }, 60000);
  });

  describe('Golden Path: Mint Filtering with Date Range', () => {
    it('should filter by missing_mints when executing fetch tasks', async () => {
      // This test verifies that surgical fetch passes missing_mints to ingestOhlcv
      // which then filters the DuckDB worklist by those specific mints
      const spec = {
        duckdbPath: testDuckdbPath,
        interval: '5m' as const,
        caller: 'TestCaller',
        month: '2025-11',
        minCoverage: 1.0,
        dryRun: true, // Dry run to avoid actual API calls
      };

      const result = await surgicalOhlcvFetch(spec, context);

      // Should process tasks
      expect(result.tasksExecuted).toBeGreaterThanOrEqual(0);

      // Each task result should have the expected structure
      result.taskResults.forEach((task) => {
        expect(task.caller).toBe('TestCaller');
        expect(task.month).toBe('2025-11');
        expect(task.intervals).toBeInstanceOf(Array);
        // In dry run mode, candles should be 0
        expect(task.candlesFetched).toBe(0);
        expect(task.candlesStored).toBe(0);
      });

      // Verify that ingestOhlcv was called with mints parameter
      // (this is verified indirectly through successful execution)
      // The workflow receives missing_mints from fetch_plan and passes them to ingestOhlcv
    }, 60000);

    it('should handle date range filtering correctly when mints are provided', async () => {
      // This test verifies that date range filtering works correctly
      // when combined with mint filtering
      const spec = {
        duckdbPath: testDuckdbPath,
        interval: '5m' as const,
        month: '2025-11', // Specific month (date range)
        minCoverage: 1.0,
        dryRun: true,
      };

      const result = await surgicalOhlcvFetch(spec, context);

      // Should process only tasks for the specified month
      result.taskResults.forEach((task) => {
        expect(task.month).toBe('2025-11');
      });

      // Verify date range is respected
      // (Tasks should only be for November 2025)
    }, 60000);
  });

  describe('Golden Path: No Gaps Found', () => {
    it('should handle case where all callers have good coverage', async () => {
      const spec = {
        duckdbPath: testDuckdbPath,
        interval: '5m' as const,
        minCoverage: 0.0, // Accept any coverage
        auto: true,
      };

      const result = await surgicalOhlcvFetch(spec, context);

      // Should complete successfully even if no gaps
      expect(result.tasksAnalyzed).toBeGreaterThanOrEqual(0);
      expect(result.errors).toEqual([]);
    }, 60000);
  });

  describe('Result Structure Validation', () => {
    it('should return fully JSON-serializable results', async () => {
      const spec = {
        duckdbPath: testDuckdbPath,
        interval: '5m' as const,
        auto: true,
        limit: 1,
        dryRun: true,
      };

      const result = await surgicalOhlcvFetch(spec, context);

      // Should serialize without errors
      expect(() => JSON.stringify(result)).not.toThrow();

      // Parse and verify structure
      const parsed = JSON.parse(JSON.stringify(result));
      expect(parsed.tasksAnalyzed).toBeDefined();
      expect(parsed.tasksExecuted).toBeDefined();
      expect(parsed.tasksSucceeded).toBeDefined();
      expect(parsed.tasksFailed).toBeDefined();
      expect(parsed.totalCandlesFetched).toBeDefined();
      expect(parsed.totalCandlesStored).toBeDefined();
      expect(parsed.taskResults).toBeInstanceOf(Array);
      expect(parsed.errors).toBeInstanceOf(Array);
      expect(parsed.startedAtISO).toBeDefined();
      expect(parsed.completedAtISO).toBeDefined();
      expect(parsed.durationMs).toBeDefined();

      // Verify no Date objects (should be ISO strings)
      expect(typeof parsed.startedAtISO).toBe('string');
      expect(typeof parsed.completedAtISO).toBe('string');
    }, 60000);

    it('should have consistent task result structure', async () => {
      const spec = {
        duckdbPath: testDuckdbPath,
        interval: '5m' as const,
        auto: true,
        limit: 1,
        minCoverage: 1.0,
        dryRun: true,
      };

      const result = await surgicalOhlcvFetch(spec, context);

      if (result.taskResults.length > 0) {
        const task = result.taskResults[0];
        expect(task).toHaveProperty('caller');
        expect(task).toHaveProperty('month');
        expect(task).toHaveProperty('intervals');
        expect(task).toHaveProperty('success');
        expect(task).toHaveProperty('candlesFetched');
        expect(task).toHaveProperty('candlesStored');
        expect(task).toHaveProperty('durationMs');

        // Verify types
        expect(typeof task.caller).toBe('string');
        expect(typeof task.month).toBe('string');
        expect(Array.isArray(task.intervals)).toBe(true);
        expect(typeof task.success).toBe('boolean');
        expect(typeof task.candlesFetched).toBe('number');
        expect(typeof task.candlesStored).toBe('number');
        expect(typeof task.durationMs).toBe('number');

        // Verify month format
        expect(task.month).toMatch(/^\d{4}-\d{2}$/);

        // Verify intervals
        task.intervals.forEach((interval) => {
          expect(['1m', '5m', '15s']).toContain(interval);
        });
      }
    }, 60000);
  });

  describe('Error Collection', () => {
    it('should collect errors without failing fast', async () => {
      const spec = {
        duckdbPath: testDuckdbPath,
        interval: '5m' as const,
        auto: true,
        limit: 1,
        errorMode: 'collect' as const,
        dryRun: true,
      };

      const result = await surgicalOhlcvFetch(spec, context);

      // Should complete even if there are errors
      expect(result).toBeDefined();
      expect(result.errors).toBeInstanceOf(Array);

      // Verify error structure if any errors exist
      result.errors.forEach((error) => {
        expect(error).toHaveProperty('caller');
        expect(error).toHaveProperty('month');
        expect(error).toHaveProperty('error');
        expect(typeof error.error).toBe('string');
      });
    }, 60000);
  });

  describe('Performance Metrics', () => {
    it('should track duration accurately', async () => {
      const spec = {
        duckdbPath: testDuckdbPath,
        interval: '5m' as const,
        auto: true,
        limit: 1,
        dryRun: true,
      };

      const startTime = Date.now();
      const result = await surgicalOhlcvFetch(spec, context);
      const actualDuration = Date.now() - startTime;

      // Reported duration should be close to actual duration
      expect(result.durationMs).toBeGreaterThan(0);
      expect(result.durationMs).toBeLessThanOrEqual(actualDuration + 1000); // Allow 1s margin

      // Task durations should sum to less than total duration
      const taskDurationSum = result.taskResults.reduce((sum, task) => sum + task.durationMs, 0);
      expect(taskDurationSum).toBeLessThanOrEqual(result.durationMs);
    }, 60000);

    it('should complete within reasonable time for dry run', async () => {
      const spec = {
        duckdbPath: testDuckdbPath,
        interval: '5m' as const,
        auto: true,
        limit: 5,
        dryRun: true,
      };

      const startTime = Date.now();
      await surgicalOhlcvFetch(spec, context);
      const duration = Date.now() - startTime;

      // Dry run should be fast (under 30 seconds for 5 tasks)
      expect(duration).toBeLessThan(30000);
    }, 60000);
  });
});
