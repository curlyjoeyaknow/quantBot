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
type DuckDbConnection = {
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
