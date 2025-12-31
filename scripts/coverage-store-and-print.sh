#!/usr/bin/env bash
set -euo pipefail

# Stores coverage snapshot (latest + history) and prints a console histogram.
#
# Inputs:
#   1) coverage summary json path (Istanbul summary) default: coverage/coverage-summary.json
#
# Outputs (default storage):
#   ~/.cache/quantbot/coverage/latest.json
#   ~/.cache/quantbot/coverage/history.ndjson
#   ~/.cache/quantbot/coverage/by-branch/<branch>.json
#
# Usage:
#   npm test -- --coverage
#   ./scripts/coverage-store-and-print.sh coverage/coverage-summary.json

COV_JSON="${1:-coverage/coverage-summary.json}"

if [[ ! -f "$COV_JSON" ]]; then
  echo "❌ Coverage JSON not found: $COV_JSON" >&2
  exit 1
fi

# Prefer XDG cache if set; else ~/.cache
CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}"
STORE_DIR="$CACHE_ROOT/quantbot/coverage"
BY_BRANCH_DIR="$STORE_DIR/by-branch"
mkdir -p "$STORE_DIR" "$BY_BRANCH_DIR"

COV_JSON="$COV_JSON" STORE_DIR="$STORE_DIR" BY_BRANCH_DIR="$BY_BRANCH_DIR" node <<'NODE'
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const covPath = process.env.COV_JSON;
const storeDir = process.env.STORE_DIR;
const byBranchDir = process.env.BY_BRANCH_DIR;

const raw = fs.readFileSync(covPath, "utf8");
const json = JSON.parse(raw);

function pickTotals(j) {
  // Istanbul coverage-summary.json shape
  if (j?.total?.lines?.pct != null) return { kind: "lines", ...j.total.lines };
  if (j?.total?.statements?.pct != null) return { kind: "statements", ...j.total.statements };
  // fallback-ish
  if (j?.lines?.pct != null) return { kind: "lines", ...j.lines };
  return null;
}

function sh(cmd) {
  try { return cp.execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return null; }
}

const totals = pickTotals(json);
if (!totals) {
  console.error("❌ Could not find coverage totals in JSON (expected Istanbul coverage-summary.json).");
  process.exit(1);
}

const pct = Number(totals.pct);
const covered = Number(totals.covered ?? 0);
const total = Number(totals.total ?? 0);
const skipped = Number(totals.skipped ?? 0);

const now = new Date();
const iso = now.toISOString();

const branch = sh("git rev-parse --abbrev-ref HEAD") ?? "unknown";
const commit = sh("git rev-parse HEAD") ?? "unknown";
const repoRoot = sh("git rev-parse --show-toplevel") ?? process.cwd();

const snapshot = {
  ts: iso,
  repoRoot,
  git: { branch, commit },
  metric: {
    kind: totals.kind, // "lines" usually
    pct,
    covered,
    total,
    skipped,
  },
  source: {
    coverageSummaryPath: covPath,
  },
};

const latestPath = path.join(storeDir, "latest.json");
fs.writeFileSync(latestPath, JSON.stringify(snapshot, null, 2));

const branchPath = path.join(byBranchDir, `${branch.replace(/[^\w.-]+/g, "_")}.json`);
fs.writeFileSync(branchPath, JSON.stringify(snapshot, null, 2));

const historyPath = path.join(storeDir, "history.ndjson");
fs.appendFileSync(historyPath, JSON.stringify(snapshot) + "\n");

// Console histogram
const width = 40;
const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
const empty = width - filled;
const bar = "█".repeat(filled) + "░".repeat(empty);

const reset = "\x1b[0m";
const green = "\x1b[32m";
const yellow = "\x1b[33m";
const red = "\x1b[31m";
const color = pct >= 90 ? green : pct >= 75 ? yellow : red;

console.log("");
console.log(`Coverage (${totals.kind}): ${pct.toFixed(2)}%`);
console.log(`${color}${bar}${reset}  ${pct.toFixed(2)}%`);
console.log(`Covered: ${covered}/${total}  Skipped: ${skipped}`);
console.log(`Stored: ${latestPath}`);
console.log("");
NODE
