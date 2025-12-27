#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./scripts/coverage-histogram.sh <coverage-json-path>
# Examples:
#   ./scripts/coverage-histogram.sh coverage/coverage-summary.json
#   npm test -- --coverage && ./scripts/coverage-histogram.sh coverage/coverage-summary.json

COV_JSON="${1:-coverage/coverage-summary.json}"

if [[ ! -f "$COV_JSON" ]]; then
  echo "❌ Coverage JSON not found: $COV_JSON" >&2
  echo "Tip: run your tests with coverage to generate it." >&2
  exit 1
fi

node <<'NODE'
const fs = require("fs");

const path = process.argv[1];
const raw = fs.readFileSync(path, "utf8");
const json = JSON.parse(raw);

// Supports common formats:
// - Istanbul coverage-summary.json: { total: { lines: { pct, total, covered, skipped }, ... } }
// - Some tools wrap it differently; we try a few fallbacks.
function getTotalLines(j) {
  if (j?.total?.lines?.pct != null) return j.total.lines;
  if (j?.total?.statements?.pct != null) return j.total.statements; // fallback if no lines
  if (j?.lines?.pct != null) return j.lines;
  return null;
}

const lines = getTotalLines(json);
if (!lines) {
  console.error("❌ Could not find coverage totals in JSON. Expected an Istanbul-style coverage summary.");
  process.exit(1);
}

const pct = Number(lines.pct);
const covered = Number(lines.covered ?? 0);
const total = Number(lines.total ?? 0);
const skipped = Number(lines.skipped ?? 0);

const width = 40; // bar width in chars
const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
const empty = width - filled;

const bar = "█".repeat(filled) + "░".repeat(empty);

// Color (works in most terminals). If you hate color, delete these.
const reset = "\x1b[0m";
const green = "\x1b[32m";
const yellow = "\x1b[33m";
const red = "\x1b[31m";

const color =
  pct >= 90 ? green :
  pct >= 75 ? yellow :
  red;

console.log("");
console.log(`Coverage (Lines): ${pct.toFixed(2)}%`);
console.log(`${color}${bar}${reset}  ${pct.toFixed(2)}%`);
console.log(`Covered: ${covered}/${total}  Skipped: ${skipped}`);
console.log("");
NODE "$COV_JSON"
