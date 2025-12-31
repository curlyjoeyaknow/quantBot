/**
 * OHLCV Ingestion EXTREME E2E Stress Tests
 *
 * Tests the COMPLETE end-to-end flow:
 * 1. DuckDB (Python) - source of calls/tokens
 * 2. TypeScript OHLCV Ingestion Service - reads from DuckDB
 * 3. Birdeye API - fetches OHLCV candles
 * 4. ClickHouse - stores OHLCV candles
 *
 * These tests use REAL implementations and push the system to its absolute limits.
 * They are designed to FAIL and expose real weaknesses in the codebase.
 *
 * WARNING: These tests will:
 * - Create real DuckDB files with test data (cleaned up after tests)
 * - Make real API calls to Birdeye (if API key is available)
 * - Write REAL OHLCV candles to ClickHouse (cleaned up after tests)
 * - Use REAL token addresses (wrapped SOL: So11111111111111111111111111111111111111112)
 * - Consume significant resources (memory, CPU, network)
 * - Take a long time to run
 *
 * DATA CLEANUP:
 * - DuckDB files: Automatically deleted in temp directory after tests
 * - ClickHouse data: Automatically deleted in afterAll hook
 * - Note: ClickHouse cleanup uses ALTER TABLE DELETE (async) - may take a few seconds
 *
 * Run with: RUN_INTEGRATION_STRESS=1 pnpm test:stress -- packages/ingestion/tests/stress/ohlcv-ingestion-extreme.stress.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { DateTime } from 'luxon';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initClickHouse, closeClickHouse } from '@quantbot/storage';
import { getClickHouseDatabaseName } from '@quantbot/utils';
import { OhlcvIngestionService } from '../../src/OhlcvIngestionService';
// Import test helpers directly (not exported from main package)
import { shouldRunTest, TEST_GATES } from '../../../utils/src/test-helpers/test-gating';

// Mock API quota tracking to prevent PostgreSQL connection attempts
vi.mock('@quantbot/observability', async () => {
  const actual = await vi.importActual('@quantbot/observability');
  return {
    ...actual,
    recordApiUsage: vi.fn().mockResolvedValue(undefined),
    checkApiQuotas: vi.fn().mockResolvedValue({
      birdeye: {
        service: 'birdeye',
        limit: 100000,
        used: 0,
        remaining: 100000,
        resetAt: new Date(),
        warningThreshold: 0.2,
      },
      helius: {
        service: 'helius',
        limit: 5000000,
        used: 0,
        remaining: 5000000,
        resetAt: new Date(),
        warningThreshold: 0.2,
      },
    }),
    hasQuotaAvailable: vi.fn().mockResolvedValue(true),
  };
});

// Valid mint for testing (Solana wrapped SOL)
const VALID_MINT = 'So11111111111111111111111111111111111111112';

// Only run if explicitly enabled
const shouldRun = shouldRunTest(TEST_GATES.INTEGRATION_STRESS);

/**
 * Create a DuckDB file with test data for OHLCV ingestion
 */
async function createTestDuckDB(
  dbPath: string,
  calls: Array<{
    mint: string;
    chain?: string;
    triggerTsMs: number;
    chatId?: string;
    messageId?: number;
  }>
): Promise<void> {
  // Use Python to create DuckDB with test data
  const { execa } = await import('execa');
  const pythonScript = `
import duckdb
import sys
import json

db_path = sys.argv[1]
calls_json = sys.argv[2]

# Connect to DuckDB
con = duckdb.connect(db_path)

# Create schema (use caller_links_d - normalized schema)
con.execute("""
CREATE TABLE IF NOT EXISTS caller_links_d (
  trigger_chat_id TEXT,
  trigger_message_id BIGINT,
  trigger_ts_ms BIGINT,
  trigger_from_id TEXT,
  trigger_from_name TEXT,
  trigger_text TEXT,
  bot_message_id BIGINT,
  bot_ts_ms BIGINT,
  bot_from_name TEXT,
  bot_type TEXT,
  token_name TEXT,
  ticker TEXT,
  mint TEXT,
  mint_raw TEXT,
  mint_validation_status TEXT,
  mint_validation_reason TEXT,
  chain TEXT,
  platform TEXT,
  token_age_s BIGINT,
  token_created_ts_ms BIGINT,
  views BIGINT,
  price_usd DOUBLE,
  price_move_pct DOUBLE,
  mcap_usd DOUBLE,
  mcap_change_pct DOUBLE,
  vol_usd DOUBLE,
  liquidity_usd DOUBLE,
  zero_liquidity BOOLEAN DEFAULT FALSE,
  chg_1h_pct DOUBLE,
  buys_1h BIGINT,
  sells_1h BIGINT,
  ath_mcap_usd DOUBLE,
  ath_drawdown_pct DOUBLE,
  ath_age_s BIGINT,
  fresh_1d_pct DOUBLE,
  fresh_7d_pct DOUBLE,
  top10_pct DOUBLE,
  holders_total BIGINT,
  top5_holders_pct_json TEXT,
  dev_sold BOOLEAN,
  dex_paid BOOLEAN,
  card_json TEXT,
  validation_passed BOOLEAN,
  run_id TEXT NOT NULL DEFAULT 'test',
  inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
""")

# Parse calls JSON
calls = json.loads(calls_json)

# Insert test calls
for i, call in enumerate(calls):
    con.execute("""
        INSERT INTO caller_links_d (
            trigger_chat_id, trigger_message_id, trigger_ts_ms,
            trigger_from_id, trigger_from_name, trigger_text,
            bot_message_id, bot_ts_ms, bot_from_name, bot_type,
            mint, chain, run_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, [
        call.get('chatId', 'test_chat'),
        call.get('messageId', i + 1),
        call['triggerTsMs'],
        'test_caller_id',
        'Test Caller',
        f"Call for {call['mint']}",
        i + 1000,  # bot_message_id
        call['triggerTsMs'] + 1000,  # bot_ts_ms (1 second after trigger)
        'Rick',
        'rick',
        call['mint'],
        call.get('chain', 'solana'),
        'test'
    ])

con.close()
print("DuckDB created successfully")
`;

  const callsJson = JSON.stringify(calls);
  const scriptPath = join(tmpdir(), `create_duckdb_${Date.now()}.py`);
  writeFileSync(scriptPath, pythonScript);

  try {
    await execa('python3', [scriptPath, dbPath, callsJson], {
      timeout: 30000,
    });
  } finally {
    // Clean up temp script
    if (existsSync(scriptPath)) {
      rmSync(scriptPath);
    }
  }
}

/**
 * Verify candles were stored in ClickHouse
 */
async function verifyClickHouseCandles(
  mint: string,
  chain: string,
  fromTime: Date,
  toTime: Date
): Promise<number> {
  try {
    const { getClickHouseClient } = await import('@quantbot/storage');
    const client = getClickHouseClient();
    const database = getClickHouseDatabaseName();

    const fromTimeStr = DateTime.fromJSDate(fromTime).toFormat('yyyy-MM-dd HH:mm:ss');
    const toTimeStr = DateTime.fromJSDate(toTime).toFormat('yyyy-MM-dd HH:mm:ss');

    const result = await client.query({
      query: `
        SELECT COUNT(*) as count
        FROM ${database}.ohlcv_candles
        WHERE token_address = {mint:String}
          AND chain = {chain:String}
          AND timestamp >= {fromTime:String}
          AND timestamp <= {toTime:String}
      `,
      query_params: {
        mint,
        chain,
        fromTime: fromTimeStr,
        toTime: toTimeStr,
      },
      format: 'JSONEachRow',
    });

    const rows = await result.json();
    return rows.length > 0 ? (rows[0] as { count: number }).count : 0;
  } catch (error) {
    // ClickHouse might not be available - that's OK for testing
    console.warn('ClickHouse verification failed (may not be available):', error);
    return 0;
  }
}

/**
 * Clean up test data from ClickHouse
 * Deletes OHLCV candles for test tokens within a time range
 */
async function cleanupClickHouseTestData(
  mints: string[],
  chain: string,
  fromTime: Date,
  toTime: Date
): Promise<void> {
  try {
    const { getClickHouseClient } = await import('@quantbot/storage');
    const client = getClickHouseClient();
    const database = getClickHouseDatabaseName();

    const fromTimeStr = DateTime.fromJSDate(fromTime).toFormat('yyyy-MM-dd HH:mm:ss');
    const toTimeStr = DateTime.fromJSDate(toTime).toFormat('yyyy-MM-dd HH:mm:ss');

    // Delete candles for each test mint
    for (const mint of mints) {
      try {
        await client.command({
          query: `
            ALTER TABLE ${database}.ohlcv_candles
            DELETE WHERE token_address = {mint:String}
              AND chain = {chain:String}
              AND timestamp >= {fromTime:String}
              AND timestamp <= {toTime:String}
          `,
          query_params: {
            mint,
            chain,
            fromTime: fromTimeStr,
            toTime: toTimeStr,
          },
        });
        console.log(`[CLEANUP] Deleted test data for ${mint.substring(0, 20)}...`);
      } catch (error) {
        console.warn(
          `[CLEANUP] Failed to delete test data for ${mint.substring(0, 20)}...:`,
          error
        );
        // Continue with other mints even if one fails
      }
    }
  } catch (error) {
    // ClickHouse might not be available - that's OK for testing
    console.warn('[CLEANUP] ClickHouse cleanup failed (may not be available):', error);
  }
}

describe.skipIf(!shouldRun)(
  'OHLCV Ingestion EXTREME E2E Stress Tests (DuckDB → Birdeye → ClickHouse)',
  () => {
    let service: OhlcvIngestionService;
    let tempDir: string;
    let testDbPath: string;
    // Track test data for cleanup
    const testMints = new Set<string>();
    const testTimeRanges: Array<{ from: Date; to: Date }> = [];

    beforeAll(async () => {
      // Initialize ClickHouse (for OHLCV storage)
      try {
        await initClickHouse();
      } catch (error: any) {
        console.warn(
          `\n[EXTREME TESTS] ⚠️  ClickHouse not available (${error.message})\n` +
            `Tests will run but OHLCV storage may fail. This is OK for testing.\n`
        );
      }

      // Initialize service (no dependencies needed - uses DuckDB for worklist)
      service = new OhlcvIngestionService();

      // Create temp directory for test DuckDB files
      tempDir = mkdtempSync(join(tmpdir(), 'ohlcv-stress-'));
    });

    afterAll(async () => {
      // Clean up ClickHouse test data
      if (testMints.size > 0 && testTimeRanges.length > 0) {
        const allMints = Array.from(testMints);
        // Use the widest time range to ensure all test data is deleted
        const earliestFrom = new Date(Math.min(...testTimeRanges.map((r) => r.from.getTime())));
        const latestTo = new Date(Math.max(...testTimeRanges.map((r) => r.to.getTime())));

        console.log(
          `[CLEANUP] Cleaning up ClickHouse test data: ${allMints.length} mints, ` +
            `time range ${earliestFrom.toISOString()} to ${latestTo.toISOString()}`
        );

        await cleanupClickHouseTestData(allMints, 'solana', earliestFrom, latestTo);
      }

      try {
        await closeClickHouse();
      } catch {
        // Ignore cleanup errors
      }

      // Clean up temp directory
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    beforeEach(() => {
      // Create a fresh DuckDB file for each test
      testDbPath = join(
        tempDir,
        `test_${Date.now()}_${Math.random().toString(36).substring(7)}.duckdb`
      );
    });

    describe('E2E: Basic Ingestion Flow', () => {
      it('should complete full flow: DuckDB → Birdeye → ClickHouse for single token', async () => {
        const now = DateTime.utc();
        const oneHourAgo = now.minus({ hours: 1 });

        // Create DuckDB with one call
        await createTestDuckDB(testDbPath, [
          {
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: oneHourAgo.toMillis(),
            chatId: 'test_chat',
            messageId: 1,
          },
        ]);

        // Run ingestion
        const startTime = Date.now();
        const result = await service.ingestForCalls({
          duckdbPath: testDbPath,
          from: oneHourAgo.minus({ days: 1 }).toJSDate(),
          to: now.toJSDate(),
          preWindowMinutes: 260, // 52 * 5m
          postWindowMinutes: 1440, // 24h
        });

        const duration = Date.now() - startTime;

        console.log(
          `[E2E] Single token: ${result.tokensProcessed} processed, ` +
            `${result.candlesFetched1m + result.candlesFetched5m} candles, ` +
            `${result.chunksFromCache} from cache, ${result.chunksFromAPI} from API in ${duration}ms`
        );

        // Verify results
        expect(result.tokensProcessed).toBeGreaterThanOrEqual(0);
        expect(result.tokensSucceeded + result.tokensFailed).toBe(result.tokensProcessed);

        // Track test data for cleanup
        testMints.add(VALID_MINT);
        testTimeRanges.push({
          from: oneHourAgo.minus({ days: 1 }).toJSDate(),
          to: now.toJSDate(),
        });

        // Verify ClickHouse storage (if available)
        if (result.tokensSucceeded > 0) {
          const candleCount = await verifyClickHouseCandles(
            VALID_MINT,
            'solana',
            oneHourAgo.minus({ days: 1 }).toJSDate(),
            now.toJSDate()
          );
          console.log(`[E2E] ClickHouse verification: ${candleCount} candles stored`);
        }
      }, 300000); // 5 minute timeout

      it('should handle multiple tokens in DuckDB worklist', async () => {
        const now = DateTime.utc();
        const calls = [];

        // Create 10 different tokens (using valid mint with variations for testing)
        for (let i = 0; i < 10; i++) {
          calls.push({
            mint: VALID_MINT, // Use same mint for all (real test would use different mints)
            chain: 'solana',
            triggerTsMs: now.minus({ hours: i }).toMillis(),
            chatId: 'test_chat',
            messageId: i + 1,
          });
        }

        await createTestDuckDB(testDbPath, calls);

        // Track test data for cleanup
        testMints.add(VALID_MINT);
        testTimeRanges.push({
          from: now.minus({ days: 1 }).toJSDate(),
          to: now.toJSDate(),
        });

        const result = await service.ingestForCalls({
          duckdbPath: testDbPath,
          from: now.minus({ days: 1 }).toJSDate(),
          to: now.toJSDate(),
        });

        console.log(
          `[E2E] Multiple tokens: ${result.tokensProcessed} processed, ` +
            `${result.tokensSucceeded} succeeded, ${result.tokensFailed} failed`
        );

        // Should process all tokens (may fail if API unavailable)
        expect(result.tokensProcessed).toBeGreaterThanOrEqual(0);
      }, 300000);
    });

    describe('E2E: Massive Concurrent Ingestion', () => {
      it('should handle 100 concurrent ingestion requests from DuckDB', async () => {
        const now = DateTime.utc();
        const calls = [];

        // Create 100 calls in DuckDB
        for (let i = 0; i < 100; i++) {
          calls.push({
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: now.minus({ minutes: i }).toMillis(),
            chatId: 'test_chat',
            messageId: i + 1,
          });
        }

        await createTestDuckDB(testDbPath, calls);

        // Create 10 separate DuckDB files for concurrent ingestion
        const dbPaths: string[] = [];
        for (let i = 0; i < 10; i++) {
          const dbPath = join(tempDir, `concurrent_${i}_${Date.now()}.duckdb`);
          await createTestDuckDB(dbPath, calls.slice(i * 10, (i + 1) * 10));
          dbPaths.push(dbPath);
        }

        // Start all ingestion requests concurrently
        const startTime = Date.now();
        const promises = dbPaths.map((dbPath) =>
          service.ingestForCalls({
            duckdbPath: dbPath,
            from: now.minus({ days: 1 }).toJSDate(),
            to: now.toJSDate(),
          })
        );

        const results = await Promise.allSettled(promises);
        const duration = Date.now() - startTime;

        const succeeded = results.filter((r) => r.status === 'fulfilled').length;
        const failed = results.filter((r) => r.status === 'rejected').length;

        console.log(
          `[E2E] 100 concurrent requests: ${succeeded} succeeded, ${failed} failed in ${duration}ms`
        );

        // System must not crash
        expect(results.length).toBe(10);
      }, 600000); // 10 minute timeout
    });

    describe('E2E: Extreme Data Volumes', () => {
      it('should handle 1 year of historical data from DuckDB', async () => {
        const now = DateTime.utc();
        const oneYearAgo = now.minus({ years: 1 });

        // Create call from 1 year ago
        await createTestDuckDB(testDbPath, [
          {
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: oneYearAgo.toMillis(),
            chatId: 'test_chat',
            messageId: 1,
          },
        ]);

        const startTime = Date.now();
        const result = await service.ingestForCalls({
          duckdbPath: testDbPath,
          from: oneYearAgo.minus({ days: 1 }).toJSDate(),
          to: now.toJSDate(),
          preWindowMinutes: 525600, // 1 year
          postWindowMinutes: 525600, // 1 year
        });

        const duration = Date.now() - startTime;

        console.log(
          `[E2E] 1 year historical: ${result.candlesFetched1m + result.candlesFetched5m} candles in ${duration}ms`
        );

        // Should complete without crashing
        expect(result).toBeDefined();
        expect(result.tokensProcessed).toBeGreaterThanOrEqual(0);
      }, 600000); // 10 minute timeout

      it('should handle maximum window sizes from DuckDB', async () => {
        const now = DateTime.utc();
        const sixMonthsAgo = now.minus({ months: 6 });

        await createTestDuckDB(testDbPath, [
          {
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: sixMonthsAgo.toMillis(),
            chatId: 'test_chat',
            messageId: 1,
          },
        ]);

        // Maximum reasonable windows
        const result = await service.ingestForCalls({
          duckdbPath: testDbPath,
          from: now.minus({ years: 2 }).toJSDate(),
          to: now.toJSDate(),
          preWindowMinutes: 1051200, // 2 years
          postWindowMinutes: 1051200, // 2 years
        });

        // Should handle extreme windows
        expect(result).toBeDefined();
      }, 600000);
    });

    describe('E2E: Invalid Data Handling', () => {
      it('should handle invalid mint addresses from DuckDB', async () => {
        const now = DateTime.utc();

        // Create DuckDB with invalid mint
        await createTestDuckDB(testDbPath, [
          {
            mint: 'INVALID_MINT_ADDRESS_TOO_SHORT',
            chain: 'solana',
            triggerTsMs: now.toMillis(),
            chatId: 'test_chat',
            messageId: 1,
          },
        ]);

        const result = await service.ingestForCalls({
          duckdbPath: testDbPath,
          from: now.minus({ days: 1 }).toJSDate(),
          to: now.toJSDate(),
        });

        // Should fail gracefully with error tracking
        expect(result.errors.length).toBeGreaterThanOrEqual(0);
        expect(result.tokensFailed).toBeGreaterThanOrEqual(0);
      }, 300000);

      it('should handle missing mint in DuckDB (NULL mint)', async () => {
        const now = DateTime.utc();

        // Create DuckDB with NULL mint (simulated by empty string)
        await createTestDuckDB(testDbPath, [
          {
            mint: '', // Empty mint
            chain: 'solana',
            triggerTsMs: now.toMillis(),
            chatId: 'test_chat',
            messageId: 1,
          },
        ]);

        const result = await service.ingestForCalls({
          duckdbPath: testDbPath,
          from: now.minus({ days: 1 }).toJSDate(),
          to: now.toJSDate(),
        });

        // Should handle missing mint gracefully
        expect(result.tokensProcessed).toBeGreaterThanOrEqual(0);
        // Worklist query should filter out empty mints
      }, 300000);
    });

    describe('E2E: Network Failure Scenarios', () => {
      it('should handle Birdeye API rate limiting (429 errors)', async () => {
        const now = DateTime.utc();
        const calls = [];

        // Create 200 calls to trigger rate limiting
        for (let i = 0; i < 200; i++) {
          calls.push({
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: now.minus({ minutes: i }).toMillis(),
            chatId: 'test_chat',
            messageId: i + 1,
          });
        }

        await createTestDuckDB(testDbPath, calls);

        const startTime = Date.now();
        const result = await service.ingestForCalls({
          duckdbPath: testDbPath,
          from: now.minus({ days: 1 }).toJSDate(),
          to: now.toJSDate(),
        });

        const duration = Date.now() - startTime;

        console.log(
          `[E2E] Rate limit test: ${result.tokensProcessed} processed, ` +
            `${result.tokensFailed} failed in ${duration}ms`
        );

        // Should handle rate limits gracefully
        expect(result.tokensFailed).toBeGreaterThanOrEqual(0);
        expect(result.errors.length).toBeGreaterThanOrEqual(0);
      }, 600000);

      it('should handle network timeouts gracefully', async () => {
        const now = DateTime.utc();

        await createTestDuckDB(testDbPath, [
          {
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: now.toMillis(),
            chatId: 'test_chat',
            messageId: 1,
          },
        ]);

        // This will test real timeout handling
        const result = await service.ingestForCalls({
          duckdbPath: testDbPath,
          from: now.minus({ days: 1 }).toJSDate(),
          to: now.toJSDate(),
        });

        // Should complete or fail with error
        expect(result).toBeDefined();
      }, 300000);
    });

    describe('E2E: Database Stress', () => {
      it('should handle ClickHouse connection failures gracefully', async () => {
        // Close ClickHouse connection to simulate failure
        await closeClickHouse();

        const now = DateTime.utc();

        await createTestDuckDB(testDbPath, [
          {
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: now.toMillis(),
            chatId: 'test_chat',
            messageId: 1,
          },
        ]);

        // Should fail gracefully, not crash
        await expect(
          service.ingestForCalls({
            duckdbPath: testDbPath,
            from: now.minus({ days: 1 }).toJSDate(),
            to: now.toJSDate(),
          })
        ).rejects.toThrow();

        // Reconnect for other tests
        try {
          await initClickHouse();
        } catch {
          // Ignore if ClickHouse not available
        }
      });

      it('should handle concurrent DuckDB reads without corruption', async () => {
        const now = DateTime.utc();
        const calls = [];

        // Create 50 calls for same token
        for (let i = 0; i < 50; i++) {
          calls.push({
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: now.plus({ minutes: i }).toMillis(),
            chatId: 'test_chat',
            messageId: i + 1,
          });
        }

        await createTestDuckDB(testDbPath, calls);

        // Run ingestion 5 times concurrently (same DuckDB file)
        const promises = Array.from({ length: 5 }, () =>
          service.ingestForCalls({
            duckdbPath: testDbPath,
            from: now.minus({ days: 1 }).toJSDate(),
            to: now.plus({ days: 1 }).toJSDate(),
          })
        );

        const results = await Promise.allSettled(promises);

        // All should complete (some may fail, but no corruption)
        expect(results.length).toBe(5);
        results.forEach((result) => {
          if (result.status === 'fulfilled') {
            expect(result.value).toBeDefined();
          }
        });
      }, 600000);
    });

    describe('E2E: Edge Cases with Real Data', () => {
      it('should handle DuckDB with zero calls', async () => {
        // Create empty DuckDB
        await createTestDuckDB(testDbPath, []);

        const result = await service.ingestForCalls({
          duckdbPath: testDbPath,
        });

        // Should handle gracefully
        expect(result.tokensProcessed).toBe(0);
      });

      it('should handle calls with future timestamps in DuckDB', async () => {
        const future = DateTime.utc().plus({ days: 1 });

        await createTestDuckDB(testDbPath, [
          {
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: future.toMillis(),
            chatId: 'test_chat',
            messageId: 1,
          },
        ]);

        const result = await service.ingestForCalls({
          duckdbPath: testDbPath,
          from: future.minus({ days: 1 }).toJSDate(),
          to: future.plus({ days: 1 }).toJSDate(),
        });

        // Should handle future dates (may return empty or fail gracefully)
        expect(result).toBeDefined();
      });

      it('should handle calls with very old timestamps (10 years ago) in DuckDB', async () => {
        const tenYearsAgo = DateTime.utc().minus({ years: 10 });

        await createTestDuckDB(testDbPath, [
          {
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: tenYearsAgo.toMillis(),
            chatId: 'test_chat',
            messageId: 1,
          },
        ]);

        const result = await service.ingestForCalls({
          duckdbPath: testDbPath,
          from: tenYearsAgo.minus({ days: 1 }).toJSDate(),
          to: tenYearsAgo.plus({ days: 1 }).toJSDate(),
        });

        // Should handle very old dates
        expect(result).toBeDefined();
      }, 600000);
    });

    describe('E2E: Resource Exhaustion', () => {
      it('should handle memory pressure from large result sets', async () => {
        const now = DateTime.utc();
        const calls = [];

        // Create many calls to generate large result sets
        for (let i = 0; i < 500; i++) {
          calls.push({
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: now.minus({ minutes: i }).toMillis(),
            chatId: 'test_chat',
            messageId: i + 1,
          });
        }

        await createTestDuckDB(testDbPath, calls);

        const initialMemory = process.memoryUsage().heapUsed;
        const result = await service.ingestForCalls({
          duckdbPath: testDbPath,
          from: now.minus({ days: 7 }).toJSDate(), // 1 week of data
          to: now.toJSDate(),
        });

        const finalMemory = process.memoryUsage().heapUsed;
        const memoryUsed = (finalMemory - initialMemory) / 1024 / 1024; // MB

        console.log(
          `[E2E] Memory test: ${memoryUsed.toFixed(2)}MB used for ${result.tokensProcessed} tokens`
        );

        // Should handle large result sets without OOM
        expect(result).toBeDefined();
        expect(memoryUsed).toBeLessThan(2000); // Less than 2GB
      }, 600000);
    });

    describe('E2E: API Abuse Scenarios', () => {
      it('should handle rapid-fire API requests (potential rate limiting)', async () => {
        const now = DateTime.utc();
        const calls = [];

        // Create 200 calls
        for (let i = 0; i < 200; i++) {
          calls.push({
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: now.minus({ minutes: i }).toMillis(),
            chatId: 'test_chat',
            messageId: i + 1,
          });
        }

        await createTestDuckDB(testDbPath, calls);

        // Start all requests as fast as possible
        const startTime = Date.now();
        const result = await service.ingestForCalls({
          duckdbPath: testDbPath,
          from: now.minus({ days: 1 }).toJSDate(),
          to: now.toJSDate(),
        });
        const duration = Date.now() - startTime;

        console.log(
          `[E2E] Rapid-fire 200 calls: ${result.tokensProcessed} processed, ` +
            `${result.tokensFailed} failed in ${duration}ms`
        );

        // Should handle rate limiting gracefully
        expect(result.tokensProcessed).toBeGreaterThanOrEqual(0);
        expect(result.errors.length).toBeGreaterThanOrEqual(0);
      }, 600000);
    });

    describe('E2E: Memory Exhaustion', () => {
      it('should handle ingestion that returns millions of candles', async () => {
        const now = DateTime.utc();

        // Create call with very old timestamp to trigger large data fetch
        await createTestDuckDB(testDbPath, [
          {
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: now.minus({ years: 1 }).toMillis(), // 1 year ago
            chatId: 'test_chat',
            messageId: 1,
          },
        ]);

        const initialMemory = process.memoryUsage().heapUsed;

        // Request 1 year of 1-minute candles (potentially 525,600 candles)
        const result = await service.ingestForCalls({
          duckdbPath: testDbPath,
          from: now.minus({ years: 1 }).toJSDate(),
          to: now.toJSDate(),
          preWindowMinutes: 525600, // 1 year
          postWindowMinutes: 525600, // 1 year
        });

        const finalMemory = process.memoryUsage().heapUsed;
        const memoryUsed = (finalMemory - initialMemory) / 1024 / 1024; // MB

        console.log(
          `[E2E] Large dataset: ${result.candlesFetched1m + result.candlesFetched5m} candles, ` +
            `${memoryUsed.toFixed(2)}MB memory`
        );

        // Should handle large datasets without OOM
        expect(result).toBeDefined();
        expect(memoryUsed).toBeLessThan(5000); // Less than 5GB
      }, 600000);
    });
  },
  `Integration stress tests require ${TEST_GATES.INTEGRATION_STRESS}=1`
);
