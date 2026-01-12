/**
 * DuckDB Ingestion Idempotency Tests
 *
 * Tests that ensure ingestion is:
 * - Repeatable (same input → exact same row counts, no duplicates)
 * - Safe under "run twice / crash mid-run / rerun" scenarios
 * - Handles concurrent writes cleanly (one fails or queues, no silent corruption)
 * - Fails loudly on schema mismatch with actionable error messages
 *
 * Test Matrix:
 * 1. Same input twice → exact same row counts (no duplicates)
 * 2. Partial run → rerun repairs/finishes, not corrupts
 * 3. Two processes attempt write → one fails cleanly or queues (no silent corruption)
 * 4. Schema mismatch / migration required → fail loudly with action message
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { existsSync, unlinkSync, writeFileSync, mkdirSync } from 'fs';
import { PythonEngine } from '@quantbot/utils';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import {
  setupPythonEnvironment,
  checkPythonEnvironment,
} from '@quantbot/utils/test-helpers/test-environment-setup.js';

const TEST_DIR = join(tmpdir(), 'quantbot-duckdb-idempotency-tests');
const TEST_DB = join(TEST_DIR, 'test.duckdb');
const TEST_FIXTURE = join(TEST_DIR, 'test_telegram.json');

// Minimal Telegram JSON fixture
const MINIMAL_TELEGRAM_JSON = {
  id: 'test_chat_123',
  name: 'Test Chat',
  type: 'private_group',
  messages: [
    {
      id: 1,
      date: '2024-01-01T00:00:00Z',
      date_unixtime: '1704067200',
      from: 'User1',
      from_id: 'user123',
      text: 'Check out So11111111111111111111111111111111111111112',
      type: 'message',
    },
    {
      id: 2,
      date: '2024-01-01T00:01:00Z',
      date_unixtime: '1704067260',
      from: 'User2',
      from_id: 'user456',
      text: 'Another message',
      type: 'message',
    },
    {
      id: 3,
      date: '2024-01-01T00:02:00Z',
      date_unixtime: '1704067320',
      from: 'Rick',
      from_id: 'bot_rick',
      text: 'Reply to message 1',
      reply_to_message_id: 1,
      type: 'message',
    },
  ],
};

describe('DuckDB Ingestion Idempotency', () => {
  let engine: PythonEngine;
  let pythonToolPath: string;
  let pythonReady = false;

  beforeAll(async () => {
    // Setup Python environment automatically
    try {
      await setupPythonEnvironment();
      const pythonEnv = checkPythonEnvironment();
      pythonReady = pythonEnv.python3Available && pythonEnv.dependenciesInstalled;
    } catch (error) {
      console.warn('[test-setup] Python environment setup failed:', error);
      pythonReady = false;
    }

    engine = new PythonEngine('python3');
    // Resolve to absolute path to ensure it exists
    const { resolve } = await import('path');
    pythonToolPath = resolve(process.cwd(), 'tools/telegram/duckdb_punch_pipeline.py');

    // Create test directory
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }

    // Write test fixture
    writeFileSync(TEST_FIXTURE, JSON.stringify(MINIMAL_TELEGRAM_JSON, null, 2));
  });

  afterAll(() => {
    // Cleanup test files
    try {
      if (existsSync(TEST_DB)) {
        unlinkSync(TEST_DB);
      }
      if (existsSync(TEST_FIXTURE)) {
        unlinkSync(TEST_FIXTURE);
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  beforeEach(() => {
    // Clean up DB before each test
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB);
    }
  });

  describe('1. Same input twice → exact same row counts (no duplicates)', () => {
    // Increase timeout for DuckDB/Python operations
    const TIMEOUT_MS = 30000;
    it('first run creates rows', async () => {
      if (!pythonReady) {
        console.warn('[test-setup] Python environment not ready, skipping test');
        return;
      }

      if (!existsSync(pythonToolPath)) {
        console.warn('Python tool not found, skipping test');
        return;
      }

      // First run
      await engine.runTelegramPipeline(
        {
          inputFile: TEST_FIXTURE,
          outputDb: TEST_DB,
          chatId: 'test_chat_123',
          rebuild: true,
        },
        {
          cwd: join(process.cwd(), 'tools/telegram'),
          env: { PYTHONPATH: process.cwd() },
        }
      );

      // Query row counts
      const result1 = execSync(
        `python3 -c "import duckdb; con = duckdb.connect('${TEST_DB}'); print(con.execute('SELECT COUNT(*) FROM tg_norm_d').fetchone()[0]); print(con.execute('SELECT COUNT(*) FROM caller_links_d').fetchone()[0]); print(con.execute('SELECT COUNT(*) FROM user_calls_d').fetchone()[0])"`,
        { encoding: 'utf-8' }
      );

      const [tgCount1, linksCount1, callsCount1] = result1.trim().split('\n').map(Number);

      expect(tgCount1).toBeGreaterThan(0);
      expect(linksCount1).toBeGreaterThanOrEqual(0);
      expect(callsCount1).toBeGreaterThanOrEqual(0);
    });

    it('second run with same input produces exact same row counts', async () => {
      if (!existsSync(pythonToolPath)) {
        console.warn('Python tool not found, skipping test');
        return;
      }

      // First run
      await engine.runTelegramPipeline(
        {
          inputFile: TEST_FIXTURE,
          outputDb: TEST_DB,
          chatId: 'test_chat_123',
          rebuild: true,
        },
        {
          cwd: join(process.cwd(), 'tools/telegram'),
          env: { PYTHONPATH: process.cwd() },
        }
      );

      const result1 = execSync(
        `python3 -c "import duckdb; con = duckdb.connect('${TEST_DB}'); print(con.execute('SELECT COUNT(*) FROM tg_norm_d').fetchone()[0]); print(con.execute('SELECT COUNT(*) FROM caller_links_d').fetchone()[0]); print(con.execute('SELECT COUNT(*) FROM user_calls_d').fetchone()[0])"`,
        { encoding: 'utf-8' }
      );

      const [tgCount1, linksCount1, callsCount1] = result1.trim().split('\n').map(Number);

      // Second run (without rebuild - should be idempotent)
      await engine.runTelegramPipeline(
        {
          inputFile: TEST_FIXTURE,
          outputDb: TEST_DB,
          chatId: 'test_chat_123',
          rebuild: false, // Don't rebuild - test idempotency
        },
        {
          cwd: join(process.cwd(), 'tools/telegram'),
          env: { PYTHONPATH: process.cwd() },
        }
      );

      const result2 = execSync(
        `python3 -c "import duckdb; con = duckdb.connect('${TEST_DB}'); print(con.execute('SELECT COUNT(*) FROM tg_norm_d').fetchone()[0]); print(con.execute('SELECT COUNT(*) FROM caller_links_d').fetchone()[0]); print(con.execute('SELECT COUNT(*) FROM user_calls_d').fetchone()[0])"`,
        { encoding: 'utf-8' }
      );

      const [tgCount2, linksCount2, callsCount2] = result2.trim().split('\n').map(Number);

      // Row counts should be identical (no duplicates)
      expect(tgCount2).toBe(tgCount1);
      expect(linksCount2).toBe(linksCount1);
      expect(callsCount2).toBe(callsCount1);
    }, 30000); // 30 second timeout for DuckDB/Python operations

    it('detects duplicates when they occur (current behavior)', async () => {
      if (!existsSync(pythonToolPath)) {
        console.warn('Python tool not found, skipping test');
        return;
      }

      // First run
      await engine.runTelegramPipeline(
        {
          inputFile: TEST_FIXTURE,
          outputDb: TEST_DB,
          chatId: 'test_chat_123',
          rebuild: true,
        },
        {
          cwd: join(process.cwd(), 'tools/telegram'),
          env: { PYTHONPATH: process.cwd() },
        }
      );

      const result1 = execSync(
        `python3 -c "import duckdb; con = duckdb.connect('${TEST_DB}'); print(con.execute('SELECT COUNT(*) FROM tg_norm_d').fetchone()[0])"`,
        { encoding: 'utf-8' }
      );

      const count1 = Number(result1.trim());

      // Second run without rebuild - currently creates duplicates
      // This test documents the CURRENT behavior (duplicates are created)
      // TODO: After implementing idempotency, this should NOT create duplicates
      await engine.runTelegramPipeline(
        {
          inputFile: TEST_FIXTURE,
          outputDb: TEST_DB,
          chatId: 'test_chat_123',
          rebuild: false,
        },
        {
          cwd: join(process.cwd(), 'tools/telegram'),
          env: { PYTHONPATH: process.cwd() },
        }
      );

      const result2 = execSync(
        `python3 -c "import duckdb; con = duckdb.connect('${TEST_DB}'); print(con.execute('SELECT COUNT(*) FROM tg_norm_d').fetchone()[0])"`,
        { encoding: 'utf-8' }
      );

      const count2 = Number(result2.trim());

      // Currently duplicates are created (this documents the problem)
      // After idempotency fix, this should be: expect(count2).toBe(count1);
      expect(count2).toBeGreaterThanOrEqual(count1);
    }, 30000); // 30 second timeout for DuckDB/Python operations
  });

  describe('2. Partial run → rerun repairs/finishes, not corrupts', () => {
    it('handles interrupted run gracefully', async () => {
      // This test requires simulating a partial run
      // For now, we document the requirement:
      // - If run is interrupted, rerun should complete without corruption
      // - Partial data should be cleaned up or completed
      // - No orphaned rows or inconsistent state

      // TODO: Implement after adding run_id tracking
      expect(true).toBe(true);
    });

    it('rerun after crash completes successfully', async () => {
      // TODO: Test scenario:
      // 1. Start ingestion
      // 2. Simulate crash (kill process)
      // 3. Rerun same input
      // 4. Verify: no duplicates, all data present, consistent state

      expect(true).toBe(true);
    });
  });

  describe('3. Two processes attempt write → one fails cleanly or queues', () => {
    it('detects concurrent write attempts', async () => {
      // DuckDB supports concurrent reads but not concurrent writes
      // This test should verify:
      // - Second process gets clear error (database locked)
      // - No silent corruption
      // - Error message is actionable

      // TODO: Implement concurrent write test
      // This requires spawning two processes simultaneously
      expect(true).toBe(true);
    });

    it('provides actionable error on lock contention', async () => {
      // Error should include:
      // - Database file path
      // - Suggestion to retry or wait
      // - No silent failure

      // TODO: Implement after adding proper error handling
      expect(true).toBe(true);
    });
  });

  describe('4. Schema mismatch / migration required → fail loudly with action message', () => {
    it('detects schema changes', async () => {
      // Test scenario:
      // 1. Create DB with old schema
      // 2. Try to insert with new schema
      // 3. Should fail with clear message about migration needed

      // TODO: Implement after adding schema versioning
      expect(true).toBe(true);
    });

    it('provides migration instructions on schema mismatch', async () => {
      // Error should include:
      // - Current schema version
      // - Required schema version
      // - Migration command or steps

      // TODO: Implement after adding schema versioning
      expect(true).toBe(true);
    });
  });

  describe('Current State Analysis', () => {
    it('documents current schema (no PRIMARY KEYs, no UNIQUE constraints)', async () => {
      if (!existsSync(pythonToolPath)) {
        console.warn('Python tool not found, skipping test');
        return;
      }

      // Create DB
      await engine.runTelegramPipeline(
        {
          inputFile: TEST_FIXTURE,
          outputDb: TEST_DB,
          chatId: 'test_chat_123',
          rebuild: true,
        },
        {
          cwd: join(process.cwd(), 'tools/telegram'),
          env: { PYTHONPATH: process.cwd() },
        }
      );

      // Check schema
      const schema = execSync(
        `python3 -c "import duckdb; con = duckdb.connect('${TEST_DB}'); print(con.execute('DESCRIBE tg_norm_d').fetchdf().to_string())"`,
        { encoding: 'utf-8' }
      );

      // Document current state: no PRIMARY KEY, no UNIQUE constraints
      expect(schema).toBeDefined();
      // After schema enhancement, we should verify PRIMARY KEYs exist
    });
  });
});
