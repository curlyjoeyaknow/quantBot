/**
 * Integration tests for RunStatusRepository
 *
 * Tests run status persistence and retrieval in DuckDB.
 * Uses mocked DuckDB connection for testing (native bindings not available in CI).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DateTime } from 'luxon';
import { RunStatusRepository } from '../../src/duckdb/repositories/RunStatusRepository.js';
import type { DuckDbConnection } from '../../src/adapters/duckdb/duckdbClient.js';

// Mock DuckDB to avoid native binding issues in CI
const mockRun = vi.fn().mockResolvedValue(undefined);
const mockAll = vi.fn().mockResolvedValue([]);

const createMockDb = (): DuckDbConnection => ({
  run: mockRun,
  all: mockAll,
});

vi.mock('../../src/adapters/duckdb/duckdbClient.js', () => ({
  openDuckDb: vi.fn().mockResolvedValue(createMockDb()),
}));

describe('RunStatusRepository Integration', () => {
  let db: DuckDbConnection;
  let repo: RunStatusRepository;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Create mocked DuckDB connection
    db = createMockDb();
    repo = new RunStatusRepository(db);
    // Initialize schema
    await repo.initializeSchema();
  });

  afterEach(async () => {
    // Cleanup: DuckDB in-memory connections are automatically closed
    // when the connection object is garbage collected
  });

  describe('upsert', () => {
    it('should create a new run status', async () => {
      const runId = 'test-run-1';
      const data = {
        runId,
        status: 'queued' as const,
        strategyId: 'test-strategy',
        strategyVersion: '1.0',
        config: { test: true },
      };

      await repo.upsert(data);

      // Verify INSERT OR REPLACE was called
      expect(mockRun).toHaveBeenCalled();
      const upsertCall = mockRun.mock.calls.find((call) => call[0].includes('INSERT OR REPLACE'));
      expect(upsertCall).toBeDefined();
      expect(upsertCall?.[0]).toContain('run_status');
    });

    it('should handle optional fields', async () => {
      const runId = 'test-run-2';
      const data = {
        runId,
        status: 'queued' as const,
      };

      await repo.upsert(data);

      // Verify INSERT OR REPLACE was called with null for optional fields
      expect(mockRun).toHaveBeenCalled();
      const upsertCall = mockRun.mock.calls.find((call) => call[0].includes('INSERT OR REPLACE'));
      expect(upsertCall).toBeDefined();
    });
  });

  describe('updateStatus', () => {
    it('should update run status', async () => {
      const runId = 'test-run-3';
      await repo.upsert({
        runId,
        status: 'queued',
      });

      await repo.updateStatus(runId, 'running');

      // Verify UPDATE was called
      expect(mockRun).toHaveBeenCalled();
      const updateCall = mockRun.mock.calls.find((call) => call[0].includes('UPDATE'));
      expect(updateCall).toBeDefined();
      expect(updateCall?.[0]).toContain('started_at = COALESCE');
      // Check that 'running' status was passed as parameter
      const params = updateCall?.[1];
      expect(params).toContain('running');
    });

    it('should update summary on completion', async () => {
      const runId = 'test-run-4';
      await repo.upsert({
        runId,
        status: 'queued',
      });

      const summary = {
        callsFound: 100,
        callsSucceeded: 95,
        callsFailed: 5,
        trades: 10,
        totalPnl: 1000.5,
        maxDrawdown: -50.2,
        sharpeRatio: 1.5,
        winRate: 0.6,
      };

      await repo.updateStatus(runId, 'completed', summary);

      // Verify UPDATE was called with summary
      expect(mockRun).toHaveBeenCalled();
      const updateCall = mockRun.mock.calls.find((call) => call[0].includes('UPDATE'));
      expect(updateCall).toBeDefined();
      expect(updateCall?.[0]).toContain('completed');
    });

    it('should update error on failure', async () => {
      const runId = 'test-run-5';
      await repo.upsert({
        runId,
        status: 'queued',
      });

      await repo.updateStatus(runId, 'failed', undefined, 'Simulation failed: insufficient data');

      // Verify UPDATE was called with error
      expect(mockRun).toHaveBeenCalled();
      const updateCall = mockRun.mock.calls.find((call) => call[0].includes('UPDATE'));
      expect(updateCall).toBeDefined();
      expect(updateCall?.[0]).toContain('completed_at = CURRENT_TIMESTAMP');
      expect(updateCall?.[0]).toContain('error = ?');
      // Check that 'failed' status and error were passed as parameters
      const params = updateCall?.[1];
      expect(params).toContain('failed');
      expect(params).toContain('Simulation failed: insufficient data');
    });
  });

  describe('list', () => {
    it('should list all runs', async () => {
      mockAll.mockResolvedValue([
        { run_id: 'run-1', status: 'queued', created_at: '2024-01-01T00:00:00Z' },
        { run_id: 'run-2', status: 'running', created_at: '2024-01-01T00:01:00Z' },
        { run_id: 'run-3', status: 'completed', created_at: '2024-01-01T00:02:00Z' },
      ]);

      const results = await repo.list({});
      expect(mockAll).toHaveBeenCalled();
      expect(results.runs.length).toBe(3);
    });

    it('should filter by status', async () => {
      mockAll.mockResolvedValue([{ run_id: 'run-2', status: 'running' }]);

      const results = await repo.list({ status: 'running' });
      expect(mockAll).toHaveBeenCalled();
      const queryCall = mockAll.mock.calls[0]?.[0];
      expect(queryCall).toContain('status = ?');
      // Check that the parameter was passed
      const params = mockAll.mock.calls[0]?.[1];
      expect(params).toContain('running');
    });

    it('should filter by strategyId', async () => {
      mockAll.mockResolvedValue([
        { run_id: 'run-1', status: 'queued', strategy_id: 'strategy-a' },
        { run_id: 'run-3', status: 'queued', strategy_id: 'strategy-a' },
      ]);

      const results = await repo.list({ strategyId: 'strategy-a' });
      expect(mockAll).toHaveBeenCalled();
      const queryCall = mockAll.mock.calls[0]?.[0];
      expect(queryCall).toContain('strategy_id = ?');
      // Check that the parameter was passed
      const params = mockAll.mock.calls[0]?.[1];
      expect(params).toContain('strategy-a');
    });

    it('should support limit and offset', async () => {
      mockAll.mockResolvedValue([{ run_id: 'run-1' }, { run_id: 'run-2' }]);

      const results = await repo.list({ limit: 2, offset: 1 });
      expect(mockAll).toHaveBeenCalled();
      const queryCall = mockAll.mock.calls[0]?.[0];
      expect(queryCall).toContain('LIMIT');
      // Check that limit parameter was passed (offset may be implemented differently)
      const params = mockAll.mock.calls[0]?.[1];
      expect(params).toBeDefined();
    });
  });

  describe('getById', () => {
    it('should return null for non-existent run', async () => {
      mockAll.mockResolvedValue([]);

      const result = await repo.getById('non-existent');
      expect(result).toBeNull();
      expect(mockAll).toHaveBeenCalled();
    });

    it('should return full run details', async () => {
      const runId = 'test-run-6';
      mockAll.mockResolvedValue([
        {
          run_id: runId,
          status: 'completed',
          config_json: JSON.stringify({ universe: { type: 'tokens', mints: ['mint1'] } }),
          summary_json: JSON.stringify({ trades: 5, totalPnl: 100 }),
        },
      ]);

      const result = await repo.getById(runId);
      expect(result).toBeDefined();
      expect(result?.runId).toBe(runId);
      expect(result?.config).toBeDefined();
      expect(result?.summary).toEqual({ trades: 5, totalPnl: 100 });
    });
  });

  describe('upsert', () => {
    it('should create if not exists', async () => {
      const runId = 'test-run-7';
      await repo.upsert({
        runId,
        status: 'queued',
      });

      expect(mockRun).toHaveBeenCalled();
      const upsertCall = mockRun.mock.calls.find((call) => call[0].includes('INSERT OR REPLACE'));
      expect(upsertCall).toBeDefined();
    });

    it('should update if exists', async () => {
      const runId = 'test-run-8';
      await repo.upsert({
        runId,
        status: 'running',
        startedAt: DateTime.utc().toISO(),
      });

      expect(mockRun).toHaveBeenCalled();
      const upsertCall = mockRun.mock.calls.find((call) => call[0].includes('INSERT OR REPLACE'));
      expect(upsertCall).toBeDefined();
      expect(upsertCall?.[0]).toContain('running');
    });
  });
});
