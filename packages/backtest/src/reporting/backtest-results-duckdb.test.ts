/**
 * Unit tests for backtest schema and insert functions
 *
 * Tests Guardrail 1: Split Truth from Policy
 * - backtest_call_path_metrics (truth rows)
 * - backtest_policy_results (policy outcome rows)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ensurePathMetricsSchema,
  insertPathMetrics,
  getPathMetricsByRun,
  ensurePolicyResultsSchema,
  insertPolicyResults,
  getPolicyResultsByRun,
} from './backtest-results-duckdb.js';
import type { PathMetricsRow, PolicyResultRow } from '../types.js';

// Mock DuckDB connection for testing
function createMockDb() {
  const tables = new Map<string, Map<string, unknown>[]>();
  const indexes = new Set<string>();

  const mockDb = {
    run(sql: string, params: unknown[], callback: (err: unknown) => void): void {
      try {
        // Parse CREATE TABLE statements
        const createTableMatch = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i);
        if (createTableMatch) {
          const tableName = createTableMatch[1];
          if (!tables.has(tableName)) {
            tables.set(tableName, []);
          }
        }

        // Parse CREATE INDEX statements
        const createIndexMatch = sql.match(/CREATE INDEX IF NOT EXISTS (\w+)/i);
        if (createIndexMatch) {
          indexes.add(createIndexMatch[1]);
        }

        callback(null);
      } catch (err) {
        callback(err);
      }
    },

    all<T = unknown>(
      sql: string,
      params: unknown[],
      callback: (err: unknown, rows: T[]) => void
    ): void {
      try {
        // Parse SELECT statements
        const selectMatch = sql.match(/FROM (\w+)/i);
        if (selectMatch) {
          const tableName = selectMatch[1];
          const tableData = tables.get(tableName) || [];

          // Simple filtering by run_id if present
          const runId = params[0];
          const filtered = runId
            ? tableData.filter((row) => (row as { run_id: string }).run_id === runId)
            : tableData;

          callback(null, filtered as T[]);
          return;
        }

        callback(null, []);
      } catch (err) {
        callback(err, []);
      }
    },

    prepare(sql: string, callback: (err: unknown, stmt: unknown) => void): void {
      // Parse INSERT statements to determine target table
      const insertMatch = sql.match(/INSERT INTO (\w+)/i);
      const tableName = insertMatch ? insertMatch[1] : null;

      const stmt = {
        run(params: unknown[], runCallback: (err: unknown) => void): void {
          try {
            if (tableName && tables.has(tableName)) {
              // Create row from params (simplified)
              const row: Record<string, unknown> = {};

              // Map params to columns based on table
              if (tableName === 'backtest_call_path_metrics') {
                const keys = [
                  'run_id',
                  'call_id',
                  'caller_name',
                  'mint',
                  'chain',
                  'interval',
                  'alert_ts_ms',
                  'p0',
                  'hit_2x',
                  't_2x_ms',
                  'hit_3x',
                  't_3x_ms',
                  'hit_4x',
                  't_4x_ms',
                  'dd_bps',
                  'dd_to_2x_bps',
                  'alert_to_activity_ms',
                  'peak_multiple',
                ];
                keys.forEach((key, idx) => {
                  row[key] = params[idx];
                });
              } else if (tableName === 'backtest_policy_results') {
                const keys = [
                  'run_id',
                  'policy_id',
                  'call_id',
                  'realized_return_bps',
                  'stop_out',
                  'max_adverse_excursion_bps',
                  'time_exposed_ms',
                  'tail_capture',
                  'entry_ts_ms',
                  'exit_ts_ms',
                  'entry_px',
                  'exit_px',
                  'exit_reason',
                ];
                keys.forEach((key, idx) => {
                  row[key] = params[idx];
                });
              }

              tables.get(tableName)!.push(row);
            }
            runCallback(null);
          } catch (err) {
            runCallback(err);
          }
        },
        finalize(finalizeCallback: () => void): void {
          finalizeCallback();
        },
      };

      callback(null, stmt);
    },

    // Expose internals for testing
    _tables: tables,
    _indexes: indexes,
  };

  return mockDb;
}

describe('Path Metrics Schema (Truth Layer)', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  describe('ensurePathMetricsSchema', () => {
    it('creates table on first run', async () => {
      await ensurePathMetricsSchema(db as any);

      expect(db._tables.has('backtest_call_path_metrics')).toBe(true);
    });

    it('is idempotent (can run twice)', async () => {
      await ensurePathMetricsSchema(db as any);
      await ensurePathMetricsSchema(db as any);

      expect(db._tables.has('backtest_call_path_metrics')).toBe(true);
    });

    it('creates indexes', async () => {
      await ensurePathMetricsSchema(db as any);

      expect(db._indexes.has('idx_path_metrics_run')).toBe(true);
      expect(db._indexes.has('idx_path_metrics_caller')).toBe(true);
      expect(db._indexes.has('idx_path_metrics_mint')).toBe(true);
    });
  });

  describe('insertPathMetrics', () => {
    it('inserts path metrics rows', async () => {
      const rows: PathMetricsRow[] = [
        {
          run_id: 'run-1',
          call_id: 'call-1',
          caller_name: 'TestCaller',
          mint: 'mint-abc',
          chain: 'solana',
          interval: '1m',
          alert_ts_ms: 1704067200000,
          p0: 1.0,
          hit_2x: true,
          t_2x_ms: 1704067260000,
          hit_3x: false,
          t_3x_ms: null,
          hit_4x: false,
          t_4x_ms: null,
          dd_bps: -500,
          dd_to_2x_bps: -300,
          alert_to_activity_ms: 5000,
          peak_multiple: 2.5,
        },
      ];

      await insertPathMetrics(db as any, rows);

      const tableData = db._tables.get('backtest_call_path_metrics');
      expect(tableData).toBeDefined();
      expect(tableData!.length).toBe(1);
      expect((tableData![0] as PathMetricsRow).run_id).toBe('run-1');
      expect((tableData![0] as PathMetricsRow).caller_name).toBe('TestCaller');
    });

    it('handles empty array without error', async () => {
      await insertPathMetrics(db as any, []);

      // Should not create table for empty insert
      expect(db._tables.has('backtest_call_path_metrics')).toBe(false);
    });

    it('handles multiple rows', async () => {
      const rows: PathMetricsRow[] = [
        {
          run_id: 'run-1',
          call_id: 'call-1',
          caller_name: 'Caller1',
          mint: 'mint-1',
          chain: 'solana',
          interval: '1m',
          alert_ts_ms: 1704067200000,
          p0: 1.0,
          hit_2x: true,
          t_2x_ms: 1704067260000,
          hit_3x: false,
          t_3x_ms: null,
          hit_4x: false,
          t_4x_ms: null,
          dd_bps: null,
          dd_to_2x_bps: null,
          alert_to_activity_ms: null,
          peak_multiple: null,
        },
        {
          run_id: 'run-1',
          call_id: 'call-2',
          caller_name: 'Caller2',
          mint: 'mint-2',
          chain: 'solana',
          interval: '1m',
          alert_ts_ms: 1704067300000,
          p0: 2.0,
          hit_2x: false,
          t_2x_ms: null,
          hit_3x: false,
          t_3x_ms: null,
          hit_4x: false,
          t_4x_ms: null,
          dd_bps: -1000,
          dd_to_2x_bps: null,
          alert_to_activity_ms: 10000,
          peak_multiple: 1.5,
        },
      ];

      await insertPathMetrics(db as any, rows);

      const tableData = db._tables.get('backtest_call_path_metrics');
      expect(tableData!.length).toBe(2);
    });
  });

  describe('getPathMetricsByRun', () => {
    it('returns path metrics for a run', async () => {
      const rows: PathMetricsRow[] = [
        {
          run_id: 'run-1',
          call_id: 'call-1',
          caller_name: 'TestCaller',
          mint: 'mint-abc',
          chain: 'solana',
          interval: '1m',
          alert_ts_ms: 1704067200000,
          p0: 1.0,
          hit_2x: true,
          t_2x_ms: 1704067260000,
          hit_3x: false,
          t_3x_ms: null,
          hit_4x: false,
          t_4x_ms: null,
          dd_bps: -500,
          dd_to_2x_bps: -300,
          alert_to_activity_ms: 5000,
          peak_multiple: 2.5,
        },
      ];

      await insertPathMetrics(db as any, rows);
      const results = await getPathMetricsByRun(db as any, 'run-1');

      expect(results.length).toBe(1);
      expect(results[0].run_id).toBe('run-1');
    });
  });
});

describe('Policy Results Schema (Policy Layer)', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  describe('ensurePolicyResultsSchema', () => {
    it('creates table on first run', async () => {
      await ensurePolicyResultsSchema(db as any);

      expect(db._tables.has('backtest_policy_results')).toBe(true);
    });

    it('is idempotent (can run twice)', async () => {
      await ensurePolicyResultsSchema(db as any);
      await ensurePolicyResultsSchema(db as any);

      expect(db._tables.has('backtest_policy_results')).toBe(true);
    });

    it('creates indexes', async () => {
      await ensurePolicyResultsSchema(db as any);

      expect(db._indexes.has('idx_policy_results_run')).toBe(true);
      expect(db._indexes.has('idx_policy_results_policy')).toBe(true);
      expect(db._indexes.has('idx_policy_results_run_policy')).toBe(true);
    });
  });

  describe('insertPolicyResults', () => {
    it('inserts policy result rows', async () => {
      const rows: PolicyResultRow[] = [
        {
          run_id: 'run-1',
          policy_id: 'policy-1',
          call_id: 'call-1',
          realized_return_bps: 500,
          stop_out: false,
          max_adverse_excursion_bps: 200,
          time_exposed_ms: 60000,
          tail_capture: 0.8,
          entry_ts_ms: 1704067200000,
          exit_ts_ms: 1704067260000,
          entry_px: 1.0,
          exit_px: 1.05,
          exit_reason: 'take_profit',
        },
      ];

      await insertPolicyResults(db as any, rows);

      const tableData = db._tables.get('backtest_policy_results');
      expect(tableData).toBeDefined();
      expect(tableData!.length).toBe(1);
      expect((tableData![0] as PolicyResultRow).run_id).toBe('run-1');
      expect((tableData![0] as PolicyResultRow).realized_return_bps).toBe(500);
    });

    it('handles stop-out scenario', async () => {
      const rows: PolicyResultRow[] = [
        {
          run_id: 'run-1',
          policy_id: 'policy-1',
          call_id: 'call-1',
          realized_return_bps: -2000,
          stop_out: true,
          max_adverse_excursion_bps: 2000,
          time_exposed_ms: 30000,
          tail_capture: null,
          entry_ts_ms: 1704067200000,
          exit_ts_ms: 1704067230000,
          entry_px: 1.0,
          exit_px: 0.8,
          exit_reason: 'stop_loss',
        },
      ];

      await insertPolicyResults(db as any, rows);

      const tableData = db._tables.get('backtest_policy_results');
      expect((tableData![0] as PolicyResultRow).stop_out).toBe(true);
      expect((tableData![0] as PolicyResultRow).realized_return_bps).toBe(-2000);
    });
  });

  describe('getPolicyResultsByRun', () => {
    it('returns policy results for a run', async () => {
      const rows: PolicyResultRow[] = [
        {
          run_id: 'run-1',
          policy_id: 'policy-1',
          call_id: 'call-1',
          realized_return_bps: 500,
          stop_out: false,
          max_adverse_excursion_bps: 200,
          time_exposed_ms: 60000,
          tail_capture: 0.8,
          entry_ts_ms: 1704067200000,
          exit_ts_ms: 1704067260000,
          entry_px: 1.0,
          exit_px: 1.05,
          exit_reason: 'take_profit',
        },
      ];

      await insertPolicyResults(db as any, rows);
      const results = await getPolicyResultsByRun(db as any, 'run-1');

      expect(results.length).toBe(1);
      expect(results[0].run_id).toBe('run-1');
    });
  });
});

describe('Schema Separation (Guardrail 1)', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it('path metrics and policy results are stored in separate tables', async () => {
    // Insert path metrics
    await insertPathMetrics(db as any, [
      {
        run_id: 'run-1',
        call_id: 'call-1',
        caller_name: 'TestCaller',
        mint: 'mint-abc',
        chain: 'solana',
        interval: '1m',
        alert_ts_ms: 1704067200000,
        p0: 1.0,
        hit_2x: true,
        t_2x_ms: 1704067260000,
        hit_3x: false,
        t_3x_ms: null,
        hit_4x: false,
        t_4x_ms: null,
        dd_bps: -500,
        dd_to_2x_bps: -300,
        alert_to_activity_ms: 5000,
        peak_multiple: 2.5,
      },
    ]);

    // Insert policy results
    await insertPolicyResults(db as any, [
      {
        run_id: 'run-1',
        policy_id: 'policy-1',
        call_id: 'call-1',
        realized_return_bps: 500,
        stop_out: false,
        max_adverse_excursion_bps: 200,
        time_exposed_ms: 60000,
        tail_capture: 0.8,
        entry_ts_ms: 1704067200000,
        exit_ts_ms: 1704067260000,
        entry_px: 1.0,
        exit_px: 1.05,
        exit_reason: 'take_profit',
      },
    ]);

    // Verify tables exist separately
    expect(db._tables.has('backtest_call_path_metrics')).toBe(true);
    expect(db._tables.has('backtest_policy_results')).toBe(true);

    // Verify each table has exactly 1 row
    expect(db._tables.get('backtest_call_path_metrics')!.length).toBe(1);
    expect(db._tables.get('backtest_policy_results')!.length).toBe(1);
  });
});
