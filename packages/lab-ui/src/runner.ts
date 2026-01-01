import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DuckDb } from "./db";
import { run } from "./db";

export type RunParams = {
  run_id: string;
  strategy_id: string;

  interval: string;
  from: string; // ISO
  to: string;   // ISO

  caller_filter?: string;

  taker_fee_bps: number;
  slippage_bps: number;
  position_usd: number;
};

export async function markRunRunning(db: DuckDb, runId: string) {
  await run(db, `UPDATE backtest_runs SET status='running', started_at=now() WHERE run_id=?`, [runId]);
}

export async function markRunDone(db: DuckDb, runId: string) {
  await run(db, `UPDATE backtest_runs SET status='done', finished_at=now() WHERE run_id=?`, [runId]);
}

export async function markRunError(db: DuckDb, runId: string, errText: string) {
  await run(db, `UPDATE backtest_runs SET status='error', finished_at=now(), error_text=? WHERE run_id=?`, [
    errText.slice(0, 20_000),
    runId
  ]);
}

export async function spawnBacktest(db: DuckDb, p: RunParams) {
  await markRunRunning(db, p.run_id);

  const args: string[] = [
    "backtest", "run",
    "--run-id", p.run_id,
    "--strategy", "exit-stack",
    "--strategy-id", p.strategy_id,
    "--interval", p.interval,
    "--from", p.from,
    "--to", p.to,
    "--taker-fee-bps", String(p.taker_fee_bps),
    "--slippage-bps", String(p.slippage_bps),
    "--position-usd", String(p.position_usd),
  ];

  if (p.caller_filter && p.caller_filter.trim().length) {
    args.push("--filter", p.caller_filter.trim());
  }

  // Prefer the worktree-local CLI. If QUANTBOT_CLI isn't set, we run:
  //   pnpm -C <repoRoot> exec -- quantbot ...
  // This avoids accidentally calling a globally-installed `quantbot` from a different checkout.
  const envCmd = process.env.QUANTBOT_CLI;
  const here = fileURLToPath(new URL(".", import.meta.url));
  const repoRoot = path.resolve(here, "..", "..", "..");

  const cmd = envCmd ?? "pnpm";
  const finalArgs = envCmd
    ? args
    : ["-C", repoRoot, "exec", "--", "quantbot", ...args];

  return new Promise<void>((resolve) => {
    const child = spawn(cmd, finalArgs, { stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    child.stderr.on("data", (d) => (stderr += String(d)));

    // keep stdout muted to avoid buffer issues
    child.stdout.on("data", () => {});

    child.on("close", async (code) => {
      if (code === 0) {
        await markRunDone(db, p.run_id);
      } else {
        await markRunError(db, p.run_id, `exit_code=${code}\n${stderr}`);
      }
      resolve();
    });
  });
}
