#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./scripts/coverage-buckets.sh <coverage-final.json-path>
# Example (jest/vitest+istanbul):
#   npm test -- --coverage && ./scripts/coverage-buckets.sh coverage/coverage-final.json

COV_FINAL="${1:-coverage/coverage-final.json}"

if [[ ! -f "$COV_FINAL" ]]; then
  echo "❌ coverage-final.json not found: $COV_FINAL" >&2
  echo "Tip: make sure your coverage reporter outputs Istanbul JSON (coverage-final.json)." >&2
  exit 1
fi

node <<'NODE'
const fs = require("fs");
const path = process.argv[1];
const data = JSON.parse(fs.readFileSync(path, "utf8"));

// Compute per-file line coverage % from Istanbul format
function fileLinePct(entry) {
  // entry.l is a map of lineNumber -> hitCount
  const lines = entry?.l;
  if (!lines) return null;
  const counts = Object.values(lines);
  if (counts.length === 0) return null;
  const covered = counts.filter((n) => Number(n) > 0).length;
  const total = counts.length;
  return (covered / total) * 100;
}

const pcts = [];
for (const [file, entry] of Object.entries(data)) {
  const pct = fileLinePct(entry);
  if (pct == null) continue;
  pcts.push({ file, pct });
}

if (pcts.length === 0) {
  console.error("❌ No per-file line coverage found in coverage-final.json (expected Istanbul format).");
  process.exit(1);
}

// Buckets: 0-9, 10-19, ... 90-99, 100
const buckets = Array.from({ length: 11 }, () => []);
for (const item of pcts) {
  const pct = item.pct;
  const idx = pct >= 100 ? 10 : Math.max(0, Math.min(9, Math.floor(pct / 10)));
  buckets[idx].push(item);
}

const maxCount = Math.max(...buckets.map((b) => b.length), 1);
const barWidth = 30;

function bar(n) {
  const filled = Math.round((n / maxCount) * barWidth);
  return "█".repeat(filled) + "░".repeat(barWidth - filled);
}

function label(i) {
  if (i === 10) return "100";
  const lo = i * 10;
  const hi = i * 10 + 9;
  return `${String(lo).padStart(2, "0")}-${String(hi).padStart(2, "0")}`;
}

const avg = pcts.reduce((a, x) => a + x.pct, 0) / pcts.length;

console.log("");
console.log(`File Coverage Histogram (Lines) — ${pcts.length} files`);
console.log(`Average: ${avg.toFixed(2)}%`);
console.log("");

for (let i = 0; i < buckets.length; i++) {
  const count = buckets[i].length;
  console.log(`${label(i)} | ${bar(count)} | ${count}`);
}

console.log("");
// Bonus: list the worst offenders (bottom 10)
const worst = [...pcts].sort((a, b) => a.pct - b.pct).slice(0, 10);
console.log("Bottom 10 files:");
for (const w of worst) {
  console.log(`  ${w.pct.toFixed(1).padStart(6, " ")}%  ${w.file}`);
}
console.log("");
NODE "$COV_FINAL"
