#!/usr/bin/env bash
set -euo pipefail

# OHLCV Coverage Map (ClickHouse)
# - Computes per-mint candle coverage over a time window and timeframe
# - Prints console histogram buckets
# - Stores latest + history snapshots for other commands to retrieve
#
# Assumed table schema (override via env vars below):
#   table: ohlcv_candles
#   columns:
#     token_address: String
#     timestamp: DateTime
#     interval: String   (timeframe as string, e.g. "5m", "1m", "15s")
#
# Env (ClickHouse connection):
#   QB_CH_HOST (default: localhost)
#   QB_CH_PORT (default: 9000)
#   QB_CH_USER (default: default)
#   QB_CH_PASSWORD (optional)
#   QB_CH_DB (default: quantbot)
#
# Env (schema):
#   QB_OHLCV_TABLE (default: ohlcv_candles)
#   QB_OHLCV_COL_MINT (default: token_address)
#   QB_OHLCV_COL_TS (default: timestamp)
#   QB_OHLCV_COL_INTERVAL (default: interval)
#
# Usage:
#   ./scripts/ohlcv-coverage-store-and-print.sh <tf> <start> <end> [mint_limit]
#
# tf:
#   "15s" | "1m" | "5m" | or seconds like "60"
#
# start/end:
#   ISO-ish: "2025-12-01 00:00:00" (interpreted in CH timezone)
#   or "2025-12-01T00:00:00"
#
# Example:
#   ./scripts/ohlcv-coverage-store-and-print.sh 1m "2025-12-20 00:00:00" "2025-12-28 00:00:00" 5000

TF_IN="${1:-}"
START_IN="${2:-}"
END_IN="${3:-}"
MINT_LIMIT="${4:-0}"

if [[ -z "$TF_IN" || -z "$START_IN" || -z "$END_IN" ]]; then
  echo "❌ Usage: $0 <tf> <start> <end> [mint_limit]" >&2
  exit 1
fi

# Parse tf -> seconds
tf_to_sec() {
  local tf="$1"
  case "$tf" in
    *s) echo "${tf%s}" ;;
    *m) echo "$(( ${tf%m} * 60 ))" ;;
    *h) echo "$(( ${tf%h} * 3600 ))" ;;
    *)
      if [[ "$tf" =~ ^[0-9]+$ ]]; then
        echo "$tf"
      else
        echo "0"
      fi
      ;;
  esac
}

TF_SEC="$(tf_to_sec "$TF_IN")"
if [[ "$TF_SEC" == "0" ]]; then
  echo "❌ Could not parse tf '$TF_IN' (use 15s / 1m / 5m / or seconds like 60)" >&2
  exit 1
fi

# ClickHouse connection
CH_HOST="${QB_CH_HOST:-localhost}"
CH_PORT="${QB_CH_PORT:-9000}"
CH_USER="${QB_CH_USER:-default}"
CH_PASSWORD="${QB_CH_PASSWORD:-}"
CH_DB="${QB_CH_DB:-quantbot}"

# Schema
TBL="${QB_OHLCV_TABLE:-ohlcv_candles}"
COL_MINT="${QB_OHLCV_COL_MINT:-token_address}"
COL_TS="${QB_OHLCV_COL_TS:-timestamp}"
COL_INTERVAL="${QB_OHLCV_COL_INTERVAL:-interval}"

# Extract table name without database prefix for system.columns query
TBL_NAME="${TBL##*.}"  # Remove database prefix if present (e.g., "quantbot.ohlcv_candles" -> "ohlcv_candles")

# Storage
CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}"
STORE_DIR="$CACHE_ROOT/quantbot/ohlcv-coverage"
BY_TF_DIR="$STORE_DIR/by-tf"
mkdir -p "$STORE_DIR" "$BY_TF_DIR"

# clickhouse-client args
CH_ARGS=(--host "$CH_HOST" --port "$CH_PORT" --user "$CH_USER" --database "$CH_DB" --format JSON)
if [[ -n "$CH_PASSWORD" ]]; then
  CH_ARGS+=(--password "$CH_PASSWORD")
fi

# Mint limit clause
LIMIT_CLAUSE=""
if [[ "$MINT_LIMIT" =~ ^[0-9]+$ ]] && [[ "$MINT_LIMIT" -gt 0 ]]; then
  LIMIT_CLAUSE="LIMIT $MINT_LIMIT"
fi

# Detect ClickHouse version and feature support
CH_VERSION="$(clickhouse-client "${CH_ARGS[@]}" --query "SELECT version()" 2>/dev/null || echo "0.0.0")"
HAS_TO_START_OF_INTERVAL=0
if [[ "$CH_VERSION" =~ ^([0-9]+)\. ]]; then
  MAJOR_VERSION="${BASH_REMATCH[1]}"
  if [[ "$MAJOR_VERSION" -ge 20 ]]; then
    HAS_TO_START_OF_INTERVAL=1
  fi
fi

# Detect if interval_seconds column exists (prefer numeric if available)
DETECT_COL_SQL="SELECT count() AS c FROM system.columns WHERE database = '$CH_DB' AND table = '$TBL_NAME' AND name = 'interval_seconds' FORMAT JSON"
HAS_INTERVAL_SECONDS=0
if DETECT_OUT="$(clickhouse-client "${CH_ARGS[@]}" --query "$DETECT_COL_SQL" 2>/dev/null)"; then
  # Parse JSON response (ClickHouse JSON format may vary)
  if echo "$DETECT_OUT" | grep -q '"c":1' || echo "$DETECT_OUT" | grep -q '"C":1'; then
    HAS_INTERVAL_SECONDS=1
  fi
fi

# Build interval filter clause (prefer interval_seconds if available)
# Note: interval is a reserved word in ClickHouse, so we quote it with backticks
if [[ "$HAS_INTERVAL_SECONDS" == "1" ]]; then
  INTERVAL_FILTER="interval_seconds = toUInt32($TF_SEC)"
else
  INTERVAL_FILTER="\`$COL_INTERVAL\` = '$TF_IN'"
fi

# We align start/end to interval boundaries for fair expected-count math.
# expected_per_mint = number of interval steps in [start_aligned, end_aligned)
# actual_per_mint = countDistinct of aligned timestamps in same range
#
# Note: This treats "coverage" as "did we get a candle for that interval at all?"
# (duplicates don't help; gaps hurt; perfect for backtest determinism)
#
# Prefers interval_seconds (numeric) if available, falls back to interval (string).
# Uses toStartOfInterval for ClickHouse 20+, falls back to modulo arithmetic for 18.x
if [[ "$HAS_TO_START_OF_INTERVAL" == "1" ]]; then
  # Modern ClickHouse (20+) - use toStartOfInterval
  SQL=$(cat <<SQL
WITH
  toDateTime(replaceRegexpAll('$START_IN', 'T', ' ')) AS start_raw,
  toDateTime(replaceRegexpAll('$END_IN', 'T', ' ')) AS end_raw,
  toStartOfInterval(start_raw, INTERVAL $TF_SEC SECOND) AS start_aligned,
  toStartOfInterval(end_raw,   INTERVAL $TF_SEC SECOND) AS end_aligned,
  -- expected number of buckets in [start_aligned, end_aligned)
  toUInt64(dateDiff('second', start_aligned, end_aligned) / $TF_SEC) AS expected_per_mint
SELECT
  $COL_MINT AS mint,
  expected_per_mint AS expected,
  countDistinct(toStartOfInterval($COL_TS, INTERVAL $TF_SEC SECOND)) AS actual,
  if(expected_per_mint = 0, 0.0, actual / expected_per_mint) AS coverage_ratio
FROM $TBL
WHERE
  $INTERVAL_FILTER
  AND $COL_TS >= start_aligned
  AND $COL_TS <  end_aligned
GROUP BY mint, expected_per_mint
ORDER BY coverage_ratio ASC
$LIMIT_CLAUSE
SQL
)
else
  # Legacy ClickHouse (18.x) - use modulo arithmetic
  SQL=$(cat <<SQL
WITH
  toDateTime(replaceRegexpAll('$START_IN', 'T', ' ')) AS start_raw,
  toDateTime(replaceRegexpAll('$END_IN', 'T', ' ')) AS end_raw,
  toDateTime(toUInt32(toRelativeSecondNum(start_raw) / $TF_SEC) * $TF_SEC) AS start_aligned,
  toDateTime(toUInt32(toRelativeSecondNum(end_raw) / $TF_SEC) * $TF_SEC) AS end_aligned,
  -- expected number of buckets in [start_aligned, end_aligned)
  toUInt64(dateDiff('second', start_aligned, end_aligned) / $TF_SEC) AS expected_per_mint
SELECT
  $COL_MINT AS mint,
  expected_per_mint AS expected,
  countDistinct(toDateTime(toUInt32(toRelativeSecondNum($COL_TS) / $TF_SEC) * $TF_SEC)) AS actual,
  if(expected_per_mint = 0, 0.0, actual / expected_per_mint) AS coverage_ratio
FROM $TBL
WHERE
  $INTERVAL_FILTER
  AND $COL_TS >= start_aligned
  AND $COL_TS <  end_aligned
GROUP BY mint, expected_per_mint
ORDER BY coverage_ratio ASC
$LIMIT_CLAUSE
SQL
)
fi

# Run query -> JSON (store in temp file to handle multiline JSON safely)
TMP_JSON=$(mktemp)
clickhouse-client "${CH_ARGS[@]}" --query "$SQL" > "$TMP_JSON"

# Process -> print histogram + store snapshot
node - "$TMP_JSON" "$STORE_DIR" "$BY_TF_DIR" "$TF_IN" "$TF_SEC" "$START_IN" "$END_IN" "$CH_HOST" "$CH_PORT" "$CH_DB" "$TBL" <<'NODE'
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const jsonFile = process.argv[2];
const storeDir = process.argv[3];
const byTfDir = process.argv[4];
const tfIn = process.argv[5];
const tfSec = Number(process.argv[6]);
const startIn = process.argv[7];
const endIn = process.argv[8];
const chHost = process.argv[9];
const chPort = process.argv[10];
const chDb   = process.argv[11];
const table  = process.argv[12];

const rawJson = fs.readFileSync(jsonFile, "utf8");

function sh(cmd) {
  try { return cp.execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return null; }
}

let parsed;
try { parsed = JSON.parse(rawJson); }
catch (e) {
  console.error("❌ Failed to parse ClickHouse JSON output");
  process.exit(1);
}

const rows = (parsed && parsed.data) ? parsed.data : [];
if (!Array.isArray(rows) || rows.length === 0) {
  console.log("");
  console.log("No rows returned. Either:");
  console.log("- no data in that window/timeframe, or");
  console.log("- schema/env vars don't match your table.");
  console.log("");
  process.exit(0);
}

// Compute overall coverage weighted by expected (correct)
let sumExpected = 0;
let sumActual = 0;
for (const r of rows) {
  const expected = Number(r.expected ?? 0);
  const actual = Number(r.actual ?? 0);
  sumExpected += expected;
  sumActual += actual;
}
const overallRatio = sumExpected > 0 ? (sumActual / sumExpected) : 0;
const overallPct = overallRatio * 100;

// Buckets on per-mint coverage %
const buckets = Array.from({ length: 11 }, () => 0); // 0-9 ... 90-99, 100
for (const r of rows) {
  const pct = Number(r.coverage_ratio ?? 0) * 100;
  const idx = pct >= 100 ? 10 : Math.max(0, Math.min(9, Math.floor(pct / 10)));
  buckets[idx] += 1;
}
const maxCount = Math.max(...buckets, 1);
const barWidth = 30;

function bar(n) {
  const filled = Math.round((n / maxCount) * barWidth);
  return "█".repeat(filled) + "░".repeat(barWidth - filled);
}
function label(i) {
  if (i === 10) return "100";
  const lo = i * 10;
  const hi = i * 10 + 9;
  return `${String(lo).padStart(2,"0")}-${String(hi).padStart(2,"0")}`;
}

// Worst offenders (bottom 10)
const worst = [...rows]
  .map(r => ({ mint: r.mint, pct: Number(r.coverage_ratio ?? 0) * 100, actual: Number(r.actual ?? 0), expected: Number(r.expected ?? 0) }))
  .sort((a,b) => a.pct - b.pct)
  .slice(0, 10);

const nowIso = new Date().toISOString();
const branch = sh("git rev-parse --abbrev-ref HEAD") ?? "unknown";
const commit = sh("git rev-parse HEAD") ?? "unknown";
const repoRoot = sh("git rev-parse --show-toplevel") ?? process.cwd();

const snapshot = {
  ts: nowIso,
  repoRoot,
  git: { branch, commit },
  query: {
    tf: tfIn,
    tf_sec: tfSec,
    start: startIn,
    end: endIn,
    clickhouse: { host: chHost, port: chPort, db: chDb, table },
    mint_count: rows.length
  },
  overall: {
    coverage_pct: Number(overallPct.toFixed(4)),
    expected_total: sumExpected,
    actual_total: sumActual
  },
  buckets: buckets.map((count, i) => ({
    range: label(i),
    count
  })),
  worst10: worst
};

const latestPath = path.join(storeDir, "latest.json");
fs.writeFileSync(latestPath, JSON.stringify(snapshot, null, 2));

const safeTf = String(tfIn).replace(/[^\w.-]+/g, "_");
const byTfPath = path.join(byTfDir, `${safeTf}.json`);
fs.writeFileSync(byTfPath, JSON.stringify(snapshot, null, 2));

const historyPath = path.join(storeDir, "history.ndjson");
fs.appendFileSync(historyPath, JSON.stringify(snapshot) + "\n");

// Print console view
const reset = "\x1b[0m";
const green = "\x1b[32m";
const yellow = "\x1b[33m";
const red = "\x1b[31m";
const color = overallPct >= 98 ? green : overallPct >= 90 ? yellow : red;

const width = 40;
const filled = Math.max(0, Math.min(width, Math.round((overallPct / 100) * width)));
const empty = width - filled;
const overallBar = "█".repeat(filled) + "░".repeat(empty);

console.log("");
console.log(`OHLCV Coverage (${tfIn})  ${startIn} -> ${endIn}`);
console.log(`${color}${overallBar}${reset}  ${overallPct.toFixed(2)}%  (weighted)`);
console.log(`Mints: ${rows.length}  Expected: ${sumExpected}  Actual: ${sumActual}`);
console.log("");
console.log("Histogram (per-mint coverage %):");
for (let i = 0; i < snapshot.buckets.length; i++) {
  const b = snapshot.buckets[i];
  console.log(`${b.range} | ${bar(b.count)} | ${b.count}`);
}
console.log("");
console.log("Bottom 10 mints:");
for (const w of worst) {
  console.log(`  ${w.pct.toFixed(2).padStart(6," ")}%  actual=${String(w.actual).padStart(6," ")} expected=${String(w.expected).padStart(6," ")}  ${w.mint}`);
}
console.log("");
console.log(`Stored: ${latestPath}`);
console.log("");
NODE

# Cleanup temp file
rm -f "$TMP_JSON"
