/**
 * Integration tests for RunRepository
 *
 * Tests run ledger persistence in ClickHouse.
 * CRITICAL: These tests verify that runs are persisted on success/failure.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DateTime } from 'luxon';
import { RunRepository } from '../../src/clickhouse/repositories/RunRepository.js';
import type { Run, RunMetrics } from '@quantbot/core';

// Mock ClickHouse client
const mockExec = vi.fn();
const mockQuery = vi.fn();
const mockInsert = vi.fn();

vi.mock('../../src/clickhouse-client.js', () => ({
  getClickHouseClient: () => ({
    exec: mockExec,
    query: mockQuery,
    insert: mockInsert,
  }),
}));

describe('RunRepository Integration', () => {
  let repo: RunRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new RunRepository();

    // Mock schema initialization
    mockExec.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue({ json: () => Promise.resolve([]) });
    mockInsert.mockResolvedValue(undefined);
  });

  describe('Happy path: createRun → insertMetrics', () => {
    it('CRITICAL: should persist run on success with metrics', async () => {
      const run: Run = {
        run_id: 'test-run-id-123',
        created_at: DateTime.utc(),
        strategy_id: 'PT2_SL25',
        params_json: JSON.stringify({ strategy: 'PT2_SL25' }),
        interval_sec: 300,
        time_from: DateTime.fromISO('2024-01-01T00:00:00Z'),
        time_to: DateTime.fromISO('2024-01-02T00:00:00Z'),
      };

      const metrics: Omit<RunMetrics, 'run_id' | 'created_at'> = {
        roi: 1.12,
        pnl_quote: 120.0,
        max_drawdown: 0.05,
        trades: 42,
        win_rate: 0.65,
        avg_hold_sec: 3600,
        fees_paid_quote: 10.0,
        slippage_paid_quote: 5.0,
      };

      // Create run
      await repo.createRun(run);

      // Verify run was inserted
      expect(mockInsert).toHaveBeenCalledTimes(1);
      const runInsertCall = mockInsert.mock.calls[0];
      expect(runInsertCall[0].table).toContain('sim_runs');
      expect(runInsertCall[0].values[0].run_id).toBe('test-run-id-123');
      expect(runInsertCall[0].values[0].status).toBe('running');

      // Insert metrics
      await repo.insertMetrics(run.run_id, metrics);

      // Verify metrics were inserted
      expect(mockInsert).toHaveBeenCalledTimes(2);
      const metricsInsertCall = mockInsert.mock.calls[1];
      expect(metricsInsertCall[0].table).toContain('sim_run_metrics');
      expect(metricsInsertCall[0].values[0].run_id).toBe('test-run-id-123');
      expect(metricsInsertCall[0].values[0].roi).toBe(1.12);
      expect(metricsInsertCall[0].values[0].trades).toBe(42);

      // Mark as success
      await repo.finishRun(run.run_id, 'success', new Date());

      // Verify run was updated
      expect(mockExec).toHaveBeenCalled();
      const updateCall = mockExec.mock.calls.find(
        (call) => call[0].query && call[0].query.includes('UPDATE')
      );
      expect(updateCall).toBeDefined();
      expect(updateCall[0].query_params.status).toBe('success');
      expect(updateCall[0].query_params.run_id).toBe('test-run-id-123');
    });
  });

  describe('Failure path: createRun → mark failed / no silent loss', () => {
    it('CRITICAL: should persist run and mark as failed on error', async () => {
      const run: Run = {
        run_id: 'test-run-id-fail-456',
        created_at: DateTime.utc(),
        strategy_id: 'PT2_SL25',
        params_json: JSON.stringify({ strategy: 'PT2_SL25' }),
        interval_sec: 300,
        time_from: DateTime.fromISO('2024-01-01T00:00:00Z'),
        time_to: DateTime.fromISO('2024-01-02T00:00:00Z'),
      };

      // Create run
      await repo.createRun(run);

      // Verify run was inserted with status 'running'
      expect(mockInsert).toHaveBeenCalledTimes(1);
      const runInsertCall = mockInsert.mock.calls[0];
      expect(runInsertCall[0].values[0].run_id).toBe('test-run-id-fail-456');
      expect(runInsertCall[0].values[0].status).toBe('running');

      // Mark as failed (simulating error during simulation)
      await repo.finishRun(run.run_id, 'failed', new Date());

      // Verify run was updated to 'failed' status
      expect(mockExec).toHaveBeenCalled();
      const updateCall = mockExec.mock.calls.find(
        (call) => call[0].query && call[0].query.includes('UPDATE')
      );
      expect(updateCall).toBeDefined();
      expect(updateCall[0].query_params.status).toBe('failed');
      expect(updateCall[0].query_params.run_id).toBe('test-run-id-fail-456');

      // CRITICAL: Verify no silent loss - run should exist even if metrics were never inserted
      // The run record should still be in the database with status 'failed'
      expect(mockInsert).toHaveBeenCalledTimes(1); // Only run insert, no metrics insert
    });

    it('CRITICAL: should not lose run record if finishRun fails', async () => {
      const run: Run = {
        run_id: 'test-run-id-fail-finish-789',
        created_at: DateTime.utc(),
        strategy_id: 'PT2_SL25',
        params_json: JSON.stringify({ strategy: 'PT2_SL25' }),
        interval_sec: 300,
        time_from: DateTime.fromISO('2024-01-01T00:00:00Z'),
        time_to: DateTime.fromISO('2024-01-02T00:00:00Z'),
      };

      // Create run
      await repo.createRun(run);

      // Verify run was inserted
      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockInsert.mock.calls[0][0].values[0].run_id).toBe('test-run-id-fail-finish-789');

      // Simulate finishRun failure (e.g., database error)
      mockExec.mockRejectedValueOnce(new Error('Database connection failed'));

      // Attempt to mark as failed - should throw but run record should still exist
      await expect(repo.finishRun(run.run_id, 'failed', new Date())).rejects.toThrow(
        'Database connection failed'
      );

      // CRITICAL: Run record should still exist (was inserted before finishRun)
      // Even though finishRun failed, the run record is not lost
      expect(mockInsert).toHaveBeenCalledTimes(1);
      const runRecord = mockInsert.mock.calls[0][0].values[0];
      expect(runRecord.run_id).toBe('test-run-id-fail-finish-789');
      expect(runRecord.status).toBe('running'); // Still 'running' since update failed
    });
  });
});
