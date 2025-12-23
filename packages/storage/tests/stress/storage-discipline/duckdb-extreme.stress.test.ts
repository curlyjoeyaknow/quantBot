/**
 * DuckDB EXTREME E2E Stress Tests
 *
 * Tests the COMPLETE DuckDB storage system under extreme conditions:
 * 1. Real DuckDBStorageService (TypeScript)
 * 2. Real PythonEngine (calls actual Python scripts)
 * 3. Real DuckDB files (created with test data)
 *
 * These tests use REAL implementations and push the system to its absolute limits.
 * They are designed to FAIL and expose real weaknesses in the codebase.
 *
 * WARNING: These tests will:
 * - Create real DuckDB files with test data (cleaned up after tests)
 * - Execute real Python scripts (duckdb_storage.py)
 * - Consume significant resources (memory, CPU, disk I/O)
 * - Take a long time to run
 *
 * DATA CLEANUP:
 * - DuckDB files: Automatically deleted in temp directory after tests
 *
 * Run with: RUN_INTEGRATION_STRESS=1 pnpm test:stress -- packages/storage/tests/stress/storage-discipline/duckdb-extreme.stress.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DuckDBStorageService } from '@quantbot/simulation';
import { getPythonEngine } from '@quantbot/utils';
import { shouldRunTest, TEST_GATES } from '@quantbot/utils/test-helpers/test-gating';

// Valid mint for testing (Solana wrapped SOL)
const VALID_MINT = 'So11111111111111111111111111111111111111112';

// Only run if explicitly enabled
const shouldRun = shouldRunTest(TEST_GATES.INTEGRATION_STRESS);

describe.skipIf(!shouldRun)('DuckDB Extreme Stress Tests (Real DuckDB)', () => {
  let tempDir: string;
  let dbPath: string;
  let storageService: DuckDBStorageService;
  let pythonEngine: ReturnType<typeof getPythonEngine>;

  beforeAll(() => {
    pythonEngine = getPythonEngine();
    storageService = new DuckDBStorageService(pythonEngine);
  });

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'duckdb-extreme-'));
    dbPath = join(tempDir, 'test.duckdb');
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Massive Concurrent Operations', () => {
    it('should handle 1000 concurrent strategy writes', async () => {
      const writes = Array.from({ length: 1000 }, (_, i) =>
        storageService.storeStrategy(
          dbPath,
          `strategy-${i}`,
          `Strategy ${i}`,
          { type: 'ichimoku', period: (i % 20) + 9 },
          { type: 'stop_loss', threshold: 0.05 + (i % 10) * 0.01 }
        )
      );

      const startTime = Date.now();
      const results = await Promise.allSettled(writes);
      const duration = Date.now() - startTime;

      // Count successes and failures
      const successful = results.filter((r) => r.status === 'fulfilled' && r.value.success);
      const failed = results.filter(
        (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)
      );

      // At least 90% should succeed (allowing for some lock contention)
      expect(successful.length).toBeGreaterThan(900);

      // Failed ones should have clear errors
      for (const result of failed) {
        if (result.status === 'fulfilled') {
          expect(result.value.error).toBeDefined();
          expect(typeof result.value.error).toBe('string');
        } else {
          expect(result.reason).toBeDefined();
        }
      }

      // Should complete in reasonable time (2 minutes for 1000 writes)
      expect(duration).toBeLessThan(120000);

      // Verify database file exists and is valid
      expect(existsSync(dbPath)).toBe(true);
      expect(readFileSync(dbPath).length).toBeGreaterThan(0);
    }, 180000); // 3 minute timeout

    it('should handle 500 concurrent run writes', async () => {
      // First, create a strategy
      const strategyId = 'concurrent-run-strategy';
      await storageService.storeStrategy(
        dbPath,
        strategyId,
        'Concurrent Run Strategy',
        { type: 'ichimoku', period: 9 },
        { type: 'stop_loss', threshold: 0.05 }
      );

      const now = new Date().toISOString();
      const writes = Array.from({ length: 500 }, (_, i) =>
        storageService.storeRun(
          dbPath,
          `run-${i}`,
          strategyId,
          'Concurrent Run Strategy',
          VALID_MINT,
          now,
          now,
          now,
          1000,
          {
            entry: { type: 'ichimoku', period: 9 },
            exit: { type: 'stop_loss', threshold: 0.05 },
          },
          `caller-${i % 10}`,
          1000 + i * 10,
          i * 0.1,
          i * 0.05,
          i * 0.5,
          i * 0.6,
          i
        )
      );

      const startTime = Date.now();
      const results = await Promise.allSettled(writes);
      const duration = Date.now() - startTime;

      const successful = results.filter((r) => r.status === 'fulfilled' && r.value.success);

      // At least 90% should succeed
      expect(successful.length).toBeGreaterThan(450);

      // Should complete in reasonable time (90 seconds for 500 writes)
      expect(duration).toBeLessThan(90000);
    }, 120000); // 2 minute timeout

    it('should handle mixed concurrent operations (strategies + runs + queries)', async () => {
      // Create initial strategies
      const initialStrategies = Array.from({ length: 10 }, (_, i) =>
        storageService.storeStrategy(
          dbPath,
          `mixed-strategy-${i}`,
          `Mixed Strategy ${i}`,
          { type: 'ichimoku', period: 9 + i },
          { type: 'stop_loss', threshold: 0.05 }
        )
      );
      await Promise.all(initialStrategies);

      // Mix of operations
      const operations: Promise<unknown>[] = [];

      // 100 more strategies
      for (let i = 10; i < 110; i++) {
        operations.push(
          storageService.storeStrategy(
            dbPath,
            `mixed-strategy-${i}`,
            `Mixed Strategy ${i}`,
            { type: 'ichimoku', period: 9 + (i % 20) },
            { type: 'stop_loss', threshold: 0.05 }
          )
        );
      }

      // 50 runs
      const now = new Date().toISOString();
      for (let i = 0; i < 50; i++) {
        operations.push(
          storageService.storeRun(
            dbPath,
            `mixed-run-${i}`,
            `mixed-strategy-${i % 10}`,
            `Mixed Strategy ${i % 10}`,
            VALID_MINT,
            now,
            now,
            now,
            1000,
            {
              entry: { type: 'ichimoku' },
              exit: { type: 'stop_loss' },
            }
          )
        );
      }

      // 20 queries
      for (let i = 0; i < 20; i++) {
        operations.push(storageService.queryCalls(dbPath, { limit: 100 }));
      }

      const startTime = Date.now();
      const results = await Promise.allSettled(operations);
      const duration = Date.now() - startTime;

      const successful = results.filter(
        (r) => r.status === 'fulfilled' && (r.value as { success?: boolean }).success !== false
      );

      // At least 80% should succeed (mixed operations are harder)
      expect(successful.length).toBeGreaterThan(136); // 80% of 170

      // Should complete in reasonable time (2 minutes)
      expect(duration).toBeLessThan(120000);
    }, 180000); // 3 minute timeout
  });

  describe('Large Data Volumes', () => {
    it('should handle 10,000 sequential strategy writes', async () => {
      const writes = Array.from({ length: 10000 }, (_, i) =>
        storageService.storeStrategy(
          dbPath,
          `large-strategy-${i}`,
          `Large Strategy ${i}`,
          {
            type: 'ichimoku',
            period: (i % 20) + 9,
            conversion_period: 9,
            base_period: 26,
            lagging_span_period: 52,
          },
          {
            type: 'stop_loss',
            threshold: 0.05 + (i % 10) * 0.01,
            trailing: i % 2 === 0,
          }
        )
      );

      const startTime = Date.now();
      const results = await Promise.all(writes);
      const duration = Date.now() - startTime;

      // All should succeed
      const successful = results.filter((r) => r.success);
      expect(successful.length).toBe(10000);

      // Should complete in reasonable time (5 minutes for 10,000 writes)
      expect(duration).toBeLessThan(300000);

      // Verify database file size is reasonable (should be at least a few MB)
      const fileSize = readFileSync(dbPath).length;
      expect(fileSize).toBeGreaterThan(100000); // At least 100KB
    }, 360000); // 6 minute timeout

    it('should handle 5,000 sequential run writes', async () => {
      // First, create a strategy
      const strategyId = 'large-run-strategy';
      await storageService.storeStrategy(
        dbPath,
        strategyId,
        'Large Run Strategy',
        { type: 'ichimoku', period: 9 },
        { type: 'stop_loss', threshold: 0.05 }
      );

      const now = new Date().toISOString();
      const writes = Array.from({ length: 5000 }, (_, i) =>
        storageService.storeRun(
          dbPath,
          `large-run-${i}`,
          strategyId,
          'Large Run Strategy',
          VALID_MINT,
          now,
          now,
          now,
          1000,
          {
            entry: { type: 'ichimoku', period: 9 },
            exit: { type: 'stop_loss', threshold: 0.05 },
          },
          `caller-${i % 100}`,
          1000 + i * 10,
          i * 0.1,
          i * 0.05,
          i * 0.5,
          i * 0.6,
          i
        )
      );

      const startTime = Date.now();
      const results = await Promise.all(writes);
      const duration = Date.now() - startTime;

      const successful = results.filter((r) => r.success);
      expect(successful.length).toBe(5000);

      // Should complete in reasonable time (3 minutes for 5,000 writes)
      expect(duration).toBeLessThan(180000);
    }, 240000); // 4 minute timeout

    it('should handle large configuration payloads (10MB+ JSON)', async () => {
      // Create a strategy with a very large config
      const largeConfig = {
        type: 'ichimoku',
        period: 9,
        data: Array(10000).fill({
          value: 'x'.repeat(100),
          nested: {
            deep: {
              structure: Array(10).fill('y'.repeat(50)),
            },
          },
        }),
      };

      const result = await storageService.storeStrategy(
        dbPath,
        'large-config-strategy',
        'Large Config Strategy',
        largeConfig,
        { type: 'stop_loss', threshold: 0.05 }
      );

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    }, 60000); // 1 minute timeout

    it('should handle querying large datasets (10,000+ records)', async () => {
      // First, create 10,000 strategies and runs
      const strategyId = 'query-large-strategy';
      await storageService.storeStrategy(
        dbPath,
        strategyId,
        'Query Large Strategy',
        { type: 'ichimoku', period: 9 },
        { type: 'stop_loss', threshold: 0.05 }
      );

      const now = new Date().toISOString();
      const runs = Array.from({ length: 10000 }, (_, i) =>
        storageService.storeRun(
          dbPath,
          `query-run-${i}`,
          strategyId,
          'Query Large Strategy',
          VALID_MINT,
          now,
          now,
          now,
          1000,
          {
            entry: { type: 'ichimoku' },
            exit: { type: 'stop_loss' },
          }
        )
      );

      await Promise.all(runs);

      // Query with large limit
      const queryResult = await storageService.queryCalls(dbPath, {
        limit: 10000,
      });

      expect(queryResult.success).toBe(true);
      expect(queryResult.calls).toBeDefined();
      expect(Array.isArray(queryResult.calls)).toBe(true);
    }, 300000); // 5 minute timeout
  });

  describe('Resource Exhaustion', () => {
    it('should handle memory pressure from many large operations', async () => {
      // Create many strategies with large configs
      const operations = Array.from({ length: 100 }, (_, i) => {
        const largeConfig = {
          type: 'ichimoku',
          period: 9,
          data: Array(1000).fill({
            value: 'x'.repeat(100),
            metadata: Array(10).fill('y'.repeat(50)),
          }),
        };

        return storageService.storeStrategy(
          dbPath,
          `memory-strategy-${i}`,
          `Memory Strategy ${i}`,
          largeConfig,
          { type: 'stop_loss', threshold: 0.05 }
        );
      });

      const results = await Promise.allSettled(operations);

      // At least 90% should succeed
      const successful = results.filter((r) => r.status === 'fulfilled' && r.value.success);
      expect(successful.length).toBeGreaterThan(90);

      // Verify database is still valid
      expect(existsSync(dbPath)).toBe(true);
    }, 120000); // 2 minute timeout

    it('should handle disk space pressure (simulated with read-only directory)', async () => {
      // Make directory read-only
      chmodSync(tempDir, 0o444);

      try {
        const result = await storageService.storeStrategy(
          dbPath,
          'readonly-test',
          'Read Only Test',
          { type: 'ichimoku' },
          { type: 'stop_loss' }
        );

        // Should fail with clear error
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error).toMatch(/permission|read-only|access|denied/i);
      } finally {
        // Restore permissions for cleanup
        chmodSync(tempDir, 0o755);
      }
    }, 30000);

    it('should handle corrupted database file gracefully', async () => {
      // Create a corrupted DuckDB file
      writeFileSync(dbPath, 'CORRUPTED_DATA_NOT_VALID_DUCKDB'.repeat(100));

      const result = await storageService.storeStrategy(
        dbPath,
        'corrupt-test',
        'Corrupt Test',
        { type: 'ichimoku' },
        { type: 'stop_loss' }
      );

      // Should fail with clear error about corruption
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/corrupt|invalid|damaged|error|failed/i);
    }, 30000);
  });

  describe('Complex Query Operations', () => {
    it('should query calls with various filters after storing many runs', async () => {
      // Create multiple strategies
      const strategies = Array.from({ length: 10 }, (_, i) =>
        storageService.storeStrategy(
          dbPath,
          `query-strategy-${i}`,
          `Query Strategy ${i}`,
          { type: 'ichimoku', period: 9 + i },
          { type: 'stop_loss', threshold: 0.05 }
        )
      );
      await Promise.all(strategies);

      // Create many runs across different strategies
      const now = new Date().toISOString();
      const runs = Array.from({ length: 500 }, (_, i) =>
        storageService.storeRun(
          dbPath,
          `query-run-${i}`,
          `query-strategy-${i % 10}`,
          `Query Strategy ${i % 10}`,
          VALID_MINT,
          now,
          now,
          now,
          1000,
          {
            entry: { type: 'ichimoku' },
            exit: { type: 'stop_loss' },
          },
          `caller-${i % 50}`
        )
      );
      await Promise.all(runs);

      // Query with different limits
      const queries = [
        storageService.queryCalls(dbPath, { limit: 10 }),
        storageService.queryCalls(dbPath, { limit: 100 }),
        storageService.queryCalls(dbPath, { limit: 1000 }),
        storageService.queryCalls(dbPath, { limit: 10000 }),
      ];

      const results = await Promise.all(queries);

      // All queries should succeed
      for (const result of results) {
        expect(result.success).toBe(true);
        expect(result.calls).toBeDefined();
        expect(Array.isArray(result.calls)).toBe(true);
      }
    }, 180000); // 3 minute timeout

    it('should handle OHLCV metadata operations with large datasets', async () => {
      const mints = Array.from({ length: 100 }, (_, i) => `mint-${i}`);
      const now = new Date().toISOString();

      // Update metadata for many mints
      const updates = mints.map((mint, i) =>
        storageService.updateOhlcvMetadata(
          dbPath,
          mint,
          now,
          300, // 5 minute interval
          now,
          now,
          i * 100
        )
      );

      const updateResults = await Promise.all(updates);
      const successfulUpdates = updateResults.filter((r) => r.success);
      expect(successfulUpdates.length).toBeGreaterThan(90);

      // Query metadata for all mints
      const queries = mints.map((mint) =>
        storageService.queryOhlcvMetadata(dbPath, mint, now, 300)
      );

      const queryResults = await Promise.all(queries);
      const successfulQueries = queryResults.filter((r) => r.success);
      expect(successfulQueries.length).toBeGreaterThan(90);
    }, 120000); // 2 minute timeout

    it('should handle OHLCV exclusions with many tokens', async () => {
      const mints = Array.from({ length: 200 }, (_, i) => `exclusion-mint-${i}`);
      const now = new Date().toISOString();

      // Add many exclusions
      const exclusions = mints.map((mint, i) =>
        storageService.addOhlcvExclusion(dbPath, mint, now, `Reason ${i}: Test exclusion`)
      );

      const exclusionResults = await Promise.all(exclusions);
      const successfulExclusions = exclusionResults.filter((r) => r.success);
      expect(successfulExclusions.length).toBeGreaterThan(180);

      // Query exclusions
      const queryResult = await storageService.queryOhlcvExclusions(
        dbPath,
        mints,
        mints.map(() => now)
      );

      expect(queryResult.success).toBe(true);
      expect(queryResult.excluded).toBeDefined();
      expect(Array.isArray(queryResult.excluded)).toBe(true);
      expect(queryResult.excluded!.length).toBeGreaterThan(0);
    }, 120000); // 2 minute timeout
  });

  describe('Performance Degradation', () => {
    it('should maintain reasonable performance with 1,000 strategies', async () => {
      // Create 1,000 strategies
      const strategies = Array.from({ length: 1000 }, (_, i) =>
        storageService.storeStrategy(
          dbPath,
          `perf-strategy-${i}`,
          `Performance Strategy ${i}`,
          { type: 'ichimoku', period: 9 + (i % 20) },
          { type: 'stop_loss', threshold: 0.05 }
        )
      );

      const startTime = Date.now();
      await Promise.all(strategies);
      const duration = Date.now() - startTime;

      // Should complete in reasonable time (30 seconds for 1,000 strategies)
      expect(duration).toBeLessThan(30000);

      // Query should still be fast
      const queryStart = Date.now();
      const queryResult = await storageService.queryCalls(dbPath, { limit: 100 });
      const queryDuration = Date.now() - queryStart;

      expect(queryResult.success).toBe(true);
      // Query should be fast even with many strategies (under 5 seconds)
      expect(queryDuration).toBeLessThan(5000);
    }, 60000); // 1 minute timeout

    it('should handle report generation with large datasets', async () => {
      // Create many strategies and runs
      const strategies = Array.from({ length: 100 }, (_, i) =>
        storageService.storeStrategy(
          dbPath,
          `report-strategy-${i}`,
          `Report Strategy ${i}`,
          { type: 'ichimoku', period: 9 },
          { type: 'stop_loss', threshold: 0.05 }
        )
      );
      await Promise.all(strategies);

      const now = new Date().toISOString();
      const runs = Array.from({ length: 500 }, (_, i) =>
        storageService.storeRun(
          dbPath,
          `report-run-${i}`,
          `report-strategy-${i % 100}`,
          `Report Strategy ${i % 100}`,
          VALID_MINT,
          now,
          now,
          now,
          1000,
          {
            entry: { type: 'ichimoku' },
            exit: { type: 'stop_loss' },
          }
        )
      );
      await Promise.all(runs);

      // Generate summary report
      const summaryResult = await storageService.generateReport(dbPath, 'summary');

      expect(summaryResult.success).toBe(true);
      expect(summaryResult.data).toBeDefined();

      // Generate strategy performance report
      const perfResult = await storageService.generateReport(
        dbPath,
        'strategy_performance',
        'report-strategy-0'
      );

      expect(perfResult.success).toBe(true);
      expect(perfResult.data).toBeDefined();
    }, 180000); // 3 minute timeout
  });

  describe('Idempotency Under Stress', () => {
    it('should maintain idempotency with concurrent duplicate writes', async () => {
      const strategyId = 'idempotent-strategy';
      const strategyData = {
        name: 'Idempotent Strategy',
        entryConfig: { type: 'ichimoku', period: 9 },
        exitConfig: { type: 'stop_loss', threshold: 0.05 },
      };

      // Write same strategy 100 times concurrently
      const writes = Array.from({ length: 100 }, () =>
        storageService.storeStrategy(
          dbPath,
          strategyId,
          strategyData.name,
          strategyData.entryConfig,
          strategyData.exitConfig
        )
      );

      const results = await Promise.all(writes);

      // All should succeed (idempotent)
      const successful = results.filter((r) => r.success);
      expect(successful.length).toBe(100);

      // All should return same strategy_id
      const strategyIds = successful.map((r) => r.strategy_id).filter((id) => id !== undefined);
      if (strategyIds.length > 0) {
        const uniqueIds = new Set(strategyIds);
        // Should have at most 1 unique ID (all point to same strategy)
        expect(uniqueIds.size).toBeLessThanOrEqual(1);
      }
    }, 60000);

    it('should maintain idempotency with concurrent duplicate run writes', async () => {
      const strategyId = 'idempotent-run-strategy';
      await storageService.storeStrategy(
        dbPath,
        strategyId,
        'Idempotent Run Strategy',
        { type: 'ichimoku', period: 9 },
        { type: 'stop_loss', threshold: 0.05 }
      );

      const runId = 'idempotent-run';
      const now = new Date().toISOString();
      const runData = {
        strategyId,
        strategyName: 'Idempotent Run Strategy',
        mint: VALID_MINT,
        alertTimestamp: now,
        startTime: now,
        endTime: now,
        initialCapital: 1000,
        strategyConfig: {
          entry: { type: 'ichimoku' },
          exit: { type: 'stop_loss' },
        },
      };

      // Write same run 50 times concurrently
      const writes = Array.from({ length: 50 }, () =>
        storageService.storeRun(
          dbPath,
          runId,
          runData.strategyId,
          runData.strategyName,
          runData.mint,
          runData.alertTimestamp,
          runData.startTime,
          runData.endTime,
          runData.initialCapital,
          runData.strategyConfig
        )
      );

      const results = await Promise.all(writes);

      // All should succeed (idempotent)
      const successful = results.filter((r) => r.success);
      expect(successful.length).toBe(50);

      // All should return same run_id
      const runIds = successful.map((r) => r.run_id).filter((id) => id !== undefined);
      if (runIds.length > 0) {
        const uniqueIds = new Set(runIds);
        // Should have at most 1 unique ID (all point to same run)
        expect(uniqueIds.size).toBeLessThanOrEqual(1);
      }
    }, 60000);
  });

  describe('Error Recovery', () => {
    it('should recover from temporary failures and continue', async () => {
      // Create a strategy
      const strategyId = 'recovery-strategy';
      await storageService.storeStrategy(
        dbPath,
        strategyId,
        'Recovery Strategy',
        { type: 'ichimoku', period: 9 },
        { type: 'stop_loss', threshold: 0.05 }
      );

      // Simulate a temporary failure by making directory read-only
      chmodSync(tempDir, 0o444);

      // This should fail
      const failResult = await storageService.storeRun(
        dbPath,
        'recovery-run',
        strategyId,
        'Recovery Strategy',
        VALID_MINT,
        new Date().toISOString(),
        new Date().toISOString(),
        new Date().toISOString(),
        1000,
        {
          entry: { type: 'ichimoku' },
          exit: { type: 'stop_loss' },
        }
      );

      expect(failResult.success).toBe(false);

      // Restore permissions
      chmodSync(tempDir, 0o755);

      // Should now succeed
      const successResult = await storageService.storeRun(
        dbPath,
        'recovery-run',
        strategyId,
        'Recovery Strategy',
        VALID_MINT,
        new Date().toISOString(),
        new Date().toISOString(),
        new Date().toISOString(),
        1000,
        {
          entry: { type: 'ichimoku' },
          exit: { type: 'stop_loss' },
        }
      );

      expect(successResult.success).toBe(true);
    }, 30000);

    it('should handle partial batch failures gracefully', async () => {
      // Create strategies - some will succeed, some will fail (due to invalid paths in some cases)
      const operations = Array.from({ length: 100 }, (_, i) => {
        // Use valid path for all
        return storageService.storeStrategy(
          dbPath,
          `partial-strategy-${i}`,
          `Partial Strategy ${i}`,
          { type: 'ichimoku', period: 9 },
          { type: 'stop_loss', threshold: 0.05 }
        );
      });

      const results = await Promise.allSettled(operations);

      // Count successes and failures
      const successful = results.filter((r) => r.status === 'fulfilled' && r.value.success);
      const failed = results.filter(
        (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)
      );

      // Most should succeed
      expect(successful.length).toBeGreaterThan(90);

      // Failed ones should have clear errors
      for (const result of failed) {
        if (result.status === 'fulfilled') {
          expect(result.value.error).toBeDefined();
        } else {
          expect(result.reason).toBeDefined();
        }
      }

      // Database should still be valid
      expect(existsSync(dbPath)).toBe(true);
    }, 60000);
  });
});
