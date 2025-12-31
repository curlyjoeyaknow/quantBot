#!/bin/bash

# Fetch OHLCV data for tokens in the worklist
# Usage: ./scripts/fetch-ohlcv-from-worklist.sh [worklist.csv] [--interval 1m|5m] [--concurrent N] [--events-only]

WORKLIST_FILE="${1:-/tmp/ohlcv-worklist.csv}"
INTERVAL="1m"
CONCURRENT=50
EVENTS_ONLY=""
DUCKDB_PATH="${DUCKDB_PATH:-data/tele.duckdb}"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --interval)
      INTERVAL="$2"
      shift 2
      ;;
    --concurrent)
      CONCURRENT="$2"
      shift 2
      ;;
    --events-only)
      EVENTS_ONLY="--events-only"
      shift
      ;;
    *)
      if [ ! -f "$WORKLIST_FILE" ] && [ -f "$1" ]; then
        WORKLIST_FILE="$1"
      fi
      shift
      ;;
  esac
done

if [ ! -f "$WORKLIST_FILE" ]; then
  echo "Error: Worklist file not found: $WORKLIST_FILE"
  echo "Generate it first with: ./scripts/generate-ohlcv-worklist.sh --format csv --output $WORKLIST_FILE"
  exit 1
fi

echo "Fetching OHLCV from worklist..."
echo "  Worklist: $WORKLIST_FILE"
echo "  Interval: $INTERVAL"
echo "  Concurrent: $CONCURRENT"
echo ""

# Extract mints that need the specified interval and pass them to the fetch command
python3 << PYTHON_EOF
import csv
import sys
import subprocess
import os

worklist_file = "$WORKLIST_FILE"
interval = "$INTERVAL"
concurrent = int("$CONCURRENT")
duckdb_path = "$DUCKDB_PATH"
events_only = "$EVENTS_ONLY"

try:
    # Read worklist and extract mints that need the specified interval
    mints_to_fetch = []
    with open(worklist_file, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            needs_1m = row.get('needs_1m', 'false').lower() == 'true'
            needs_5m = row.get('needs_5m', 'false').lower() == 'true'
            mint = row.get('mint', '').strip()
            
            if not mint:
                continue
            
            # Check if this token needs the specified interval
            if interval == '1m' and needs_1m:
                mints_to_fetch.append(mint)
            elif interval == '5m' and needs_5m:
                mints_to_fetch.append(mint)
    
    if not mints_to_fetch:
        print(f"No tokens need {interval} interval data", file=sys.stderr)
        sys.exit(0)
    
    print(f"Found {len(mints_to_fetch)} tokens needing {interval} interval", file=sys.stderr)
    print("", file=sys.stderr)
    
    # Pass mints as environment variable (comma-separated)
    # The handler will filter to only these mints
    mints_env = ','.join(mints_to_fetch)
    
    cmd = [
        'quantbot', 'ohlcv', 'fetch-from-duckdb',
        '--duckdb', duckdb_path,
        '--interval', interval,
        '--concurrent', str(concurrent),
        '--side', 'buy'
    ]
    
    if events_only:
        cmd.append('--events-only')
    
    print(f"Running fetch for {len(mints_to_fetch)} tokens...", file=sys.stderr)
    print("(Handler will skip tokens that already have >= 10,000 candles)", file=sys.stderr)
    print("", file=sys.stderr)
    
    # Run the command with mints filter
    env = os.environ.copy()
    env['OHLCV_FETCH_MINTS'] = mints_env
    
    result = subprocess.run(cmd, env=env)
    sys.exit(result.returncode)
    
except Exception as e:
    print(f"ERROR: {str(e)}", file=sys.stderr)
    import traceback
    traceback.print_exc(file=sys.stderr)
    sys.exit(1)
PYTHON_EOF
