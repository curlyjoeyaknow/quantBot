#!/usr/bin/env bash
set -euo pipefail

OUT="${1:-out/sweep-debug}"
CALLS="${2:-calls.json}"

# Check if calls file exists
if [ ! -f "$CALLS" ]; then
  echo "Error: Calls file not found: $CALLS" >&2
  echo "Usage: $0 [output-dir] [calls-file]" >&2
  exit 1
fi

mkdir -p "$OUT"

# Make a 5-call slice so we can iterate fast.
CALL_COUNT=$(python3 - <<PY
import json, sys
try:
    calls = json.load(open("$CALLS"))
    if not isinstance(calls, list):
        print("0", file=sys.stderr)
        sys.exit(1)
    calls = calls[:5]
    open("$OUT/calls.slice.json", "w").write(json.dumps(calls, indent=2))
    print(len(calls))
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
PY
)

if [ "$CALL_COUNT" -eq 0 ]; then
  echo "Error: No calls found in $CALLS (or file is empty/invalid)" >&2
  exit 1
fi

echo "Wrote $CALL_COUNT calls to $OUT/calls.slice.json"

# Check if overlays file exists (optional, but warn if missing)
OVERLAYS_FILE="${3:-overlays.json}"
if [ ! -f "$OVERLAYS_FILE" ]; then
  echo "Warning: Overlays file not found: $OVERLAYS_FILE" >&2
  echo "Creating minimal overlays file..." >&2
  echo '[{"kind":"take_profit","takePct":100}]' > "$OUT/overlays.json"
  OVERLAYS_FILE="$OUT/overlays.json"
fi

# Run sweep (pass all args after the script name)
echo "Running sweep with:"
echo "  calls-file: $OUT/calls.slice.json"
echo "  intervals: [\"5m\"]"
echo "  lags-ms: [10000]"
echo "  overlays-file: $OVERLAYS_FILE"
echo "  out: $OUT"
echo ""

bash scripts/dev/run-calls-sweep-tsx.sh calls sweep \
  --calls-file "$OUT/calls.slice.json" \
  --intervals '["5m"]' \
  --lags-ms '[10000]' \
  --overlays-file "$OVERLAYS_FILE" \
  --out "$OUT" 2>&1 | tee "$OUT/sweep.log"

echo ""
echo "Done. Inspect:"
ls -lah "$OUT"
echo ""
echo "First 30 lines of run.meta.json:"
head -n 30 "$OUT/run.meta.json" 2>/dev/null || echo "run.meta.json not found"

