import type { PathMetricsRow, PolicyResultRow } from '../types.js';

export type CallResultRow = {
  run_id: string;
  call_id: string | number;
  caller_name: string;
  mint: string;
  interval: string;

  entry_ts_ms: number;
  exit_ts_ms: number;
  entry_px: number;
  exit_px: number;

  return_bps: number; // net
  pnl_usd: number;

  hold_ms: number;
  max_favorable_bps?: number | null;
  max_adverse_bps?: number | null;
  exit_reason?: string | null;

  // === path metrics ===
  t0_ms?: number | null;
  p0?: number | null;

  hit_2x?: boolean | null;
  t_2x_ms?: number | null;

  hit_3x?: boolean | null;
  t_3x_ms?: number | null;

  hit_4x?: boolean | null;
  t_4x_ms?: number | null;

  dd_bps?: number | null;
  dd_to_2x_bps?: number | null;

  alert_to_activity_ms?: number | null;
  peak_multiple?: number | null;
};

// DuckDB connection type (callback-based API)
export type DuckDbConnection = {
  run(sql: string, params: any[], callback: (err: any) => void): void;
  all<T = any>(sql: string, params: any[], callback: (err: any, rows: T[]) => void): void;
  prepare(sql: string, callback: (err: any, stmt: any) => void): void;
};

function run(db: DuckDbConnection, sql: string, params: any[] = []) {
  return new Promise<void>((resolve, reject) => {
    db.run(sql, params, (err: any) => (err ? reject(err) : resolve()));
  });
}

function all<T>(db: DuckDbConnection, sql: string, params: any[] = []) {
  return new Promise<T[]>((resolve, reject) => {
    db.all(sql, params, (err: any, rows: T[]) => (err ? reject(err) : resolve(rows)));
  });
}

function prepare(db: DuckDbConnection, sql: string) {
  return new Promise<any>((resolve, reject) => {
    db.prepare(sql, (err: any, stmt: any) => (err ? reject(err) : resolve(stmt)));
  });
}

function stmtRun(stmt: any, params: any[]) {
  return new Promise<void>((resolve, reject) => {
    stmt.run(params, (err: any) => (err ? reject(err) : resolve()));
  });
}

function finalize(stmt: any) {
  return new Promise<void>((resolve) => stmt.finalize(() => resolve()));
}

async function ensureColumns(
  db: DuckDbConnection,
  table: string,
  cols: Array<{ name: string; type: string }>
) {
  const info = await all<{ name: string }>(db, `PRAGMA table_info('${table}')`);
  const existing = new Set(info.map((r) => r.name));

  for (const c of cols) {
    if (!existing.has(c.name)) {
      await run(db, `ALTER TABLE ${table} ADD COLUMN ${c.name} ${c.type}`);
    }
  }
}

export async function ensureBacktestSchema(db: DuckDbConnection) {
  // Base table (old + new; safe if already exists)
  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS backtest_call_results (
      run_id TEXT NOT NULL,
      call_id TEXT NOT NULL,
      caller_name TEXT NOT NULL,
      mint TEXT NOT NULL,
      interval TEXT NOT NULL,

      entry_ts_ms BIGINT NOT NULL,
      exit_ts_ms BIGINT NOT NULL,
      entry_px DOUBLE NOT NULL,
      exit_px DOUBLE NOT NULL,

      return_bps DOUBLE NOT NULL,
      pnl_usd DOUBLE NOT NULL,

      hold_ms BIGINT NOT NULL,
      max_favorable_bps DOUBLE,
      max_adverse_bps DOUBLE,
      exit_reason TEXT,

      created_at TIMESTAMP DEFAULT now()
    );
    `,
    []
  );

  await ensureColumns(db, 'backtest_call_results', [
    { name: 't0_ms', type: 'BIGINT' },
    { name: 'p0', type: 'DOUBLE' },

    { name: 'hit_2x', type: 'BOOLEAN' },
    { name: 't_2x_ms', type: 'BIGINT' },

    { name: 'hit_3x', type: 'BOOLEAN' },
    { name: 't_3x_ms', type: 'BIGINT' },

    { name: 'hit_4x', type: 'BOOLEAN' },
    { name: 't_4x_ms', type: 'BIGINT' },

    { name: 'dd_bps', type: 'DOUBLE' },
    { name: 'dd_to_2x_bps', type: 'DOUBLE' },

    { name: 'alert_to_activity_ms', type: 'BIGINT' },
    { name: 'peak_multiple', type: 'DOUBLE' },
  ]);

  // Indexes (best-effort; DuckDB ignores some index syntax depending on version)
  await run(db, `CREATE INDEX IF NOT EXISTS idx_btr_run ON backtest_call_results(run_id);`).catch(
    () => {}
  );
  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_btr_caller ON backtest_call_results(caller_name);`
  ).catch(() => {});
  await run(db, `CREATE INDEX IF NOT EXISTS idx_btr_mint ON backtest_call_results(mint);`).catch(
    () => {}
  );
}

export async function insertCallResults(db: DuckDbConnection, rows: CallResultRow[]) {
  if (rows.length === 0) return;

  await ensureBacktestSchema(db);

  const stmt = await prepare(
    db,
    `
    INSERT INTO backtest_call_results (
      run_id, call_id, caller_name, mint, interval,
      entry_ts_ms, exit_ts_ms, entry_px, exit_px,
      return_bps, pnl_usd, hold_ms,
      max_favorable_bps, max_adverse_bps, exit_reason,

      t0_ms, p0,
      hit_2x, t_2x_ms,
      hit_3x, t_3x_ms,
      hit_4x, t_4x_ms,
      dd_bps, dd_to_2x_bps,
      alert_to_activity_ms, peak_multiple
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9,
      $10, $11, $12,
      $13, $14, $15,

      $16, $17,
      $18, $19,
      $20, $21,
      $22, $23,
      $24, $25,
      $26, $27
    )
    `
  );

  try {
    for (const r of rows) {
      await stmtRun(stmt, [
        r.run_id,
        String(r.call_id),
        r.caller_name,
        r.mint,
        r.interval,

        r.entry_ts_ms,
        r.exit_ts_ms,
        r.entry_px,
        r.exit_px,

        r.return_bps,
        r.pnl_usd,
        r.hold_ms,

        r.max_favorable_bps ?? null,
        r.max_adverse_bps ?? null,
        r.exit_reason ?? null,

        r.t0_ms ?? null,
        r.p0 ?? null,

        r.hit_2x ?? null,
        r.t_2x_ms ?? null,

        r.hit_3x ?? null,
        r.t_3x_ms ?? null,

        r.hit_4x ?? null,
        r.t_4x_ms ?? null,

        r.dd_bps ?? null,
        r.dd_to_2x_bps ?? null,

        r.alert_to_activity_ms ?? null,
        r.peak_multiple ?? null,
      ]);
    }
  } finally {
    await finalize(stmt);
  }
}

// =============================================================================
// Path Metrics Schema (Truth Layer - Guardrail 1)
// =============================================================================

/**
 * Ensure backtest_call_path_metrics table exists
 * This is the TRUTH LAYER - 1 row per eligible call, always written
 */
export async function ensurePathMetricsSchema(db: DuckDbConnection) {
  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS backtest_call_path_metrics (
      run_id TEXT NOT NULL,
      call_id TEXT NOT NULL,
      caller_name TEXT NOT NULL,
      mint TEXT NOT NULL,
      chain TEXT NOT NULL,
      interval TEXT NOT NULL,
      
      -- Anchor
      alert_ts_ms BIGINT NOT NULL,
      p0 DOUBLE NOT NULL,
      
      -- Multiples
      hit_2x BOOLEAN NOT NULL,
      t_2x_ms BIGINT,
      hit_3x BOOLEAN NOT NULL,
      t_3x_ms BIGINT,
      hit_4x BOOLEAN NOT NULL,
      t_4x_ms BIGINT,
      
      -- Drawdown
      dd_bps DOUBLE,
      dd_to_2x_bps DOUBLE,
      
      -- Activity
      alert_to_activity_ms BIGINT,
      
      -- Summary
      peak_multiple DOUBLE,
      
      created_at TIMESTAMP DEFAULT now(),
      PRIMARY KEY (run_id, call_id)
    );
    `,
    []
  );

  // Indexes (best-effort)
  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_path_metrics_run ON backtest_call_path_metrics(run_id);`
  ).catch(() => {});
  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_path_metrics_caller ON backtest_call_path_metrics(caller_name);`
  ).catch(() => {});
  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_path_metrics_mint ON backtest_call_path_metrics(mint);`
  ).catch(() => {});
}

/**
 * Insert path metrics rows (truth layer)
 * 1 row per eligible call - always written regardless of trades
 */
export async function insertPathMetrics(db: DuckDbConnection, rows: PathMetricsRow[]) {
  if (rows.length === 0) return;

  await ensurePathMetricsSchema(db);

  const stmt = await prepare(
    db,
    `
    INSERT INTO backtest_call_path_metrics (
      run_id, call_id, caller_name, mint, chain, interval,
      alert_ts_ms, p0,
      hit_2x, t_2x_ms,
      hit_3x, t_3x_ms,
      hit_4x, t_4x_ms,
      dd_bps, dd_to_2x_bps,
      alert_to_activity_ms, peak_multiple
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8,
      $9, $10,
      $11, $12,
      $13, $14,
      $15, $16,
      $17, $18
    )
    `
  );

  try {
    for (const r of rows) {
      await stmtRun(stmt, [
        r.run_id,
        r.call_id,
        r.caller_name,
        r.mint,
        r.chain,
        r.interval,

        r.alert_ts_ms,
        r.p0,

        r.hit_2x,
        r.t_2x_ms ?? null,

        r.hit_3x,
        r.t_3x_ms ?? null,

        r.hit_4x,
        r.t_4x_ms ?? null,

        r.dd_bps ?? null,
        r.dd_to_2x_bps ?? null,

        r.alert_to_activity_ms ?? null,
        r.peak_multiple ?? null,
      ]);
    }
  } finally {
    await finalize(stmt);
  }
}

// =============================================================================
// Policy Results Schema (Policy Layer - Guardrail 1)
// =============================================================================

/**
 * Ensure backtest_policy_results table exists
 * This is the POLICY LAYER - only written when trades execute
 */
export async function ensurePolicyResultsSchema(db: DuckDbConnection) {
  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS backtest_policy_results (
      run_id TEXT NOT NULL,
      policy_id TEXT NOT NULL,
      call_id TEXT NOT NULL,
      
      -- Policy execution outcomes
      realized_return_bps DOUBLE NOT NULL,
      stop_out BOOLEAN NOT NULL,
      max_adverse_excursion_bps DOUBLE NOT NULL,
      time_exposed_ms BIGINT NOT NULL,
      tail_capture DOUBLE,
      
      -- Entry/exit details
      entry_ts_ms BIGINT NOT NULL,
      exit_ts_ms BIGINT NOT NULL,
      entry_px DOUBLE NOT NULL,
      exit_px DOUBLE NOT NULL,
      exit_reason TEXT,
      
      created_at TIMESTAMP DEFAULT now(),
      PRIMARY KEY (run_id, policy_id, call_id)
    );
    `,
    []
  );

  // Indexes (best-effort)
  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_policy_results_run ON backtest_policy_results(run_id);`
  ).catch(() => {});
  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_policy_results_policy ON backtest_policy_results(policy_id);`
  ).catch(() => {});
  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_policy_results_run_policy ON backtest_policy_results(run_id, policy_id);`
  ).catch(() => {});
}

/**
 * Insert policy results rows (policy layer)
 * Only written when policies are executed against calls
 */
export async function insertPolicyResults(db: DuckDbConnection, rows: PolicyResultRow[]) {
  if (rows.length === 0) return;

  await ensurePolicyResultsSchema(db);

  const stmt = await prepare(
    db,
    `
    INSERT INTO backtest_policy_results (
      run_id, policy_id, call_id,
      realized_return_bps, stop_out, max_adverse_excursion_bps,
      time_exposed_ms, tail_capture,
      entry_ts_ms, exit_ts_ms, entry_px, exit_px, exit_reason
    ) VALUES (
      $1, $2, $3,
      $4, $5, $6,
      $7, $8,
      $9, $10, $11, $12, $13
    )
    `
  );

  try {
    for (const r of rows) {
      await stmtRun(stmt, [
        r.run_id,
        r.policy_id,
        r.call_id,

        r.realized_return_bps,
        r.stop_out,
        r.max_adverse_excursion_bps,

        r.time_exposed_ms,
        r.tail_capture ?? null,

        r.entry_ts_ms,
        r.exit_ts_ms,
        r.entry_px,
        r.exit_px,
        r.exit_reason ?? null,
      ]);
    }
  } finally {
    await finalize(stmt);
  }
}

/**
 * Query path metrics for a specific run
 */
export async function getPathMetricsByRun(
  db: DuckDbConnection,
  runId: string
): Promise<PathMetricsRow[]> {
  await ensurePathMetricsSchema(db);

  return all<PathMetricsRow>(
    db,
    `SELECT * FROM backtest_call_path_metrics WHERE run_id = $1 ORDER BY caller_name, call_id`,
    [runId]
  );
}

/**
 * Query policy results for a specific run and policy
 */
export async function getPolicyResultsByRun(
  db: DuckDbConnection,
  runId: string,
  policyId?: string
): Promise<PolicyResultRow[]> {
  await ensurePolicyResultsSchema(db);

  if (policyId) {
    return all<PolicyResultRow>(
      db,
      `SELECT * FROM backtest_policy_results WHERE run_id = $1 AND policy_id = $2 ORDER BY call_id`,
      [runId, policyId]
    );
  }

  return all<PolicyResultRow>(
    db,
    `SELECT * FROM backtest_policy_results WHERE run_id = $1 ORDER BY policy_id, call_id`,
    [runId]
  );
}
