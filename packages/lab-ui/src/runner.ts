import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DuckDb } from './db.js';
import { run } from './db.js';

/**
 * Parameters for spawning backtest runs
 * Supports multiple run modes: exit-stack, path-only, policy, optimize
 */
export type RunParams = {
  run_id: string;
  strategy_id?: string;

  // Run mode: exit-stack (default), path-only, policy, optimize
  run_mode?: 'exit-stack' | 'path-only' | 'policy' | 'optimize';

  interval?: string;
  from?: string; // ISO
  to?: string; // ISO

  caller_filter?: string;
  mint_filter?: string;

  // Exit-stack specific
  taker_fee_bps?: number;
  slippage_bps?: number;
  position_usd?: number;

  // Policy/Optimize specific
  path_only_run_id?: string;
  policy_json?: string;
  caller?: string;
  policy_type?: string;
  constraints_json?: string;
  grid_json?: string;
  execution_model?: string;
};

export async function markRunRunning(db: DuckDb, runId: string) {
  await run(db, `UPDATE backtest_runs SET status='running', started_at=now() WHERE run_id=?`, [
    runId,
  ]);
}

export async function markRunDone(db: DuckDb, runId: string) {
  await run(db, `UPDATE backtest_runs SET status='done', finished_at=now() WHERE run_id=?`, [
    runId,
  ]);
}

export async function markRunError(db: DuckDb, runId: string, errText: string) {
  await run(
    db,
    `UPDATE backtest_runs SET status='error', finished_at=now(), error_text=? WHERE run_id=?`,
    [errText.slice(0, 20_000), runId]
  );
}

/**
 * Build CLI args based on run mode
 */
function buildCliArgs(p: RunParams): string[] {
  const mode = p.run_mode ?? 'exit-stack';

  switch (mode) {
    case 'path-only':
      return buildPathOnlyArgs(p);
    case 'policy':
      return buildPolicyArgs(p);
    case 'optimize':
      return buildOptimizeArgs(p);
    default:
      return buildExitStackArgs(p);
  }
}

function buildExitStackArgs(p: RunParams): string[] {
  const args: string[] = ['backtest', 'run', '--run-id', p.run_id, '--strategy', 'exit-stack'];

  if (p.strategy_id) {
    args.push('--strategy-id', p.strategy_id);
  }
  if (p.interval) {
    args.push('--interval', p.interval);
  }
  if (p.from) {
    args.push('--from', p.from);
  }
  if (p.to) {
    args.push('--to', p.to);
  }
  if (p.taker_fee_bps !== undefined) {
    args.push('--taker-fee-bps', String(p.taker_fee_bps));
  }
  if (p.slippage_bps !== undefined) {
    args.push('--slippage-bps', String(p.slippage_bps));
  }
  if (p.position_usd !== undefined) {
    args.push('--position-usd', String(p.position_usd));
  }
  if (p.caller_filter?.trim()) {
    args.push('--filter', p.caller_filter.trim());
  }

  return args;
}

function buildPathOnlyArgs(p: RunParams): string[] {
  const args: string[] = ['backtest', 'run', '--run-id', p.run_id, '--strategy', 'path-only'];

  if (p.interval) {
    args.push('--interval', p.interval);
  }
  if (p.from) {
    args.push('--from', p.from);
  }
  if (p.to) {
    args.push('--to', p.to);
  }
  if (p.caller_filter?.trim()) {
    args.push('--filter', p.caller_filter.trim());
  }
  if (p.mint_filter?.trim()) {
    args.push('--mint-filter', p.mint_filter.trim());
  }

  return args;
}

function buildPolicyArgs(p: RunParams): string[] {
  const args: string[] = ['backtest', 'policy', '--run-id', p.run_id];

  // Required options
  if (p.interval) {
    args.push('--interval', p.interval);
  }
  if (p.from) {
    args.push('--from', p.from);
  }
  if (p.to) {
    args.push('--to', p.to);
  }

  // Policy JSON
  if (p.policy_json) {
    args.push('--policy-json', p.policy_json);
  }

  // Optional filter (note: CLI uses --filter, not --caller)
  if (p.caller_filter?.trim()) {
    args.push('--filter', p.caller_filter.trim());
  }

  // Execution settings
  if (p.taker_fee_bps !== undefined) {
    args.push('--taker-fee-bps', String(p.taker_fee_bps));
  }
  if (p.slippage_bps !== undefined) {
    args.push('--slippage-bps', String(p.slippage_bps));
  }
  if (p.execution_model) {
    args.push('--execution-model', p.execution_model);
  }

  return args;
}

function buildOptimizeArgs(p: RunParams): string[] {
  const args: string[] = ['backtest', 'optimize', '--run-id', p.run_id];

  // Required options
  if (p.interval) {
    args.push('--interval', p.interval);
  }
  if (p.from) {
    args.push('--from', p.from);
  }
  if (p.to) {
    args.push('--to', p.to);
  }

  // Optional options
  if (p.caller) {
    args.push('--caller', p.caller);
  }
  if (p.policy_type) {
    args.push('--policy-type', p.policy_type);
  }
  
  // Parse constraints JSON to extract individual constraint options
  if (p.constraints_json) {
    try {
      const constraints = JSON.parse(p.constraints_json);
      if (constraints.maxStopOutRate !== undefined) {
        args.push('--max-stop-out-rate', String(constraints.maxStopOutRate));
      }
      if (constraints.maxP95DrawdownBps !== undefined) {
        args.push('--max-p95-drawdown-bps', String(constraints.maxP95DrawdownBps));
      }
      if (constraints.maxTimeExposedMs !== undefined) {
        args.push('--max-time-exposed-ms', String(constraints.maxTimeExposedMs));
      }
    } catch {
      // If JSON parsing fails, skip constraint options
    }
  }

  if (p.taker_fee_bps !== undefined) {
    args.push('--taker-fee-bps', String(p.taker_fee_bps));
  }
  if (p.slippage_bps !== undefined) {
    args.push('--slippage-bps', String(p.slippage_bps));
  }
  if (p.execution_model) {
    args.push('--execution-model', p.execution_model);
  }

  if (p.grid_json) {
    args.push('--grid-json', p.grid_json);
  }

  return args;
}

export async function spawnBacktest(db: DuckDb, p: RunParams) {
  await markRunRunning(db, p.run_id);

  const args = buildCliArgs(p);

  // Prefer the worktree-local CLI. If QUANTBOT_CLI isn't set, we run:
  //   pnpm -C <repoRoot> cli ...
  // This avoids accidentally calling a globally-installed `quantbot` from a different checkout.
  const envCmd = process.env.QUANTBOT_CLI;
  const here = fileURLToPath(new URL('.', import.meta.url));
  const repoRoot = path.resolve(here, '..', '..', '..');

  const cmd = envCmd ?? 'pnpm';
  const finalArgs = envCmd 
    ? args 
    : ['-C', repoRoot, 'cli', ...args];

  // Debug logging
  if (process.env.LAB_UI_DEBUG_SPAWN) {
    console.log('[spawnBacktest] Command:', cmd);
    console.log('[spawnBacktest] Args:', JSON.stringify(finalArgs, null, 2));
    console.log('[spawnBacktest] Full command:', [cmd, ...finalArgs].join(' '));
  }

  return new Promise<void>((resolve) => {
    const child = spawn(cmd, finalArgs, { 
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false, // Explicitly disable shell to prevent argument splitting
      cwd: repoRoot, // Set working directory to repo root
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += String(d);
      if (process.env.LAB_UI_DEBUG_SPAWN) {
        console.log('[spawnBacktest] stdout:', String(d));
      }
    });
    child.stderr.on('data', (d) => {
      stderr += String(d);
      if (process.env.LAB_UI_DEBUG_SPAWN) {
        console.log('[spawnBacktest] stderr:', String(d));
      }
    });

    child.on('error', async (err) => {
      const errorMsg = `spawn error: ${err.message}\nstdout: ${stdout}\nstderr: ${stderr}`;
      await markRunError(db, p.run_id, errorMsg);
      resolve();
    });

    child.on('close', async (code) => {
      if (code === 0) {
        await markRunDone(db, p.run_id);
      } else {
        const errorMsg = `exit_code=${code}\nstdout: ${stdout}\nstderr: ${stderr}`;
        await markRunError(db, p.run_id, errorMsg);
      }
      resolve();
    });
  });
}
