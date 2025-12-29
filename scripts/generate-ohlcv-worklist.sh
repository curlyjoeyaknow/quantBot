#!/bin/bash

# Generate worklist of tokens that don't have >= 10,000 candles for each interval
# Usage: ./scripts/generate-ohlcv-worklist.sh [--format json|table|csv] [--output file.txt]

DUCKDB_PATH="${DUCKDB_PATH:-data/tele.duckdb}"
CLICKHOUSE_CONTAINER="${CLICKHOUSE_CONTAINER:-quantbot-clickhouse-1}"
MIN_CANDLES=10000
FORMAT="table"
OUTPUT_FILE=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --format)
      FORMAT="$2"
      shift 2
      ;;
    --output|-o)
      OUTPUT_FILE="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--format json|table|csv] [--output file.txt]"
      exit 1
      ;;
  esac
done

echo "Generating OHLCV worklist..."
echo "Checking tokens that need >= $MIN_CANDLES candles for 1m and 5m intervals"
echo ""

# Get all unique mints from DuckDB
python3 << PYTHON_EOF
import duckdb
import subprocess
import sys
import json

duckdb_path = "$DUCKDB_PATH"
container = "$CLICKHOUSE_CONTAINER"
min_candles = $MIN_CANDLES
output_format = "$FORMAT"
output_file = "$OUTPUT_FILE"

try:
    # Get all unique mints from DuckDB
    conn = duckdb.connect(duckdb_path, read_only=True)
    result = conn.execute("""
        SELECT DISTINCT mint
        FROM (
            SELECT DISTINCT mint FROM caller_links_d 
            WHERE mint IS NOT NULL AND mint != ''
            UNION
            SELECT DISTINCT mint FROM user_calls_d 
            WHERE mint IS NOT NULL AND mint != ''
        )
        ORDER BY mint
    """).fetchall()
    
    all_mints = [row[0] for row in result if row[0]]
    conn.close()
    
    print(f"Found {len(all_mints)} unique tokens in DuckDB", file=sys.stderr)
    print("Checking candle counts in ClickHouse...", file=sys.stderr)
    
    # Get candle counts for all mints using a single aggregated query (much faster)
    print("Querying ClickHouse for candle counts...", file=sys.stderr)
    
    # Query for both intervals in one go using conditional aggregation
    query = """
    SELECT 
        token_address,
        sumIf(1, interval = 60) as count_1m,
        sumIf(1, interval = 300) as count_5m
    FROM quantbot.ohlcv_candles
    WHERE interval IN (60, 300)
    GROUP BY token_address
    """
    
    result = subprocess.run(
        ['docker', 'exec', container, 'clickhouse-client', '--query', query, '--format', 'CSV'],
        capture_output=True,
        text=True
    )
    
    counts_1m = {}
    counts_5m = {}
    
    if result.returncode == 0:
        for line in result.stdout.strip().split('\n'):
            if line and ',' in line:
                parts = line.split(',')
                if len(parts) >= 3:
                    mint = parts[0].strip('"')
                    try:
                        count_1m = int(parts[1].strip('"'))
                        count_5m = int(parts[2].strip('"'))
                        if count_1m > 0:
                            counts_1m[mint] = count_1m
                        if count_5m > 0:
                            counts_5m[mint] = count_5m
                    except ValueError:
                        pass
    
    # Categorize tokens
    needs_1m = []
    needs_5m = []
    has_both = []
    has_neither = []
    
    for mint in all_mints:
        count_1m = counts_1m.get(mint, 0)
        count_5m = counts_5m.get(mint, 0)
        
        has_1m = count_1m >= min_candles
        has_5m = count_5m >= min_candles
        
        if has_1m and has_5m:
            has_both.append({
                'mint': mint,
                'count_1m': count_1m,
                'count_5m': count_5m
            })
        elif has_1m and not has_5m:
            needs_5m.append({
                'mint': mint,
                'count_1m': count_1m,
                'count_5m': count_5m
            })
        elif not has_1m and has_5m:
            needs_1m.append({
                'mint': mint,
                'count_1m': count_1m,
                'count_5m': count_5m
            })
        else:
            has_neither.append({
                'mint': mint,
                'count_1m': count_1m,
                'count_5m': count_5m
            })
    
    # Prepare output
    output_lines = []
    
    if output_format == 'json':
        output = {
            'summary': {
                'total_tokens': len(all_mints),
                'has_both_intervals': len(has_both),
                'needs_1m_only': len(needs_1m),
                'needs_5m_only': len(needs_5m),
                'needs_both': len(has_neither)
            },
            'needs_1m': needs_1m,
            'needs_5m': needs_5m,
            'needs_both': has_neither
        }
        output_lines.append(json.dumps(output, indent=2))
    elif output_format == 'csv':
        output_lines.append("mint,needs_1m,needs_5m,count_1m,count_5m")
        for item in needs_1m:
            output_lines.append(f"{item['mint']},true,false,{item['count_1m']},{item['count_5m']}")
        for item in needs_5m:
            output_lines.append(f"{item['mint']},false,true,{item['count_1m']},{item['count_5m']}")
        for item in has_neither:
            output_lines.append(f"{item['mint']},true,true,{item['count_1m']},{item['count_5m']}")
    else:  # table format
        output_lines.append("=" * 80)
        output_lines.append("OHLCV Worklist Summary")
        output_lines.append("=" * 80)
        output_lines.append(f"Total tokens: {len(all_mints)}")
        output_lines.append(f"Has both intervals (>= {min_candles} candles): {len(has_both)}")
        output_lines.append(f"Needs 1m only: {len(needs_1m)}")
        output_lines.append(f"Needs 5m only: {len(needs_5m)}")
        output_lines.append(f"Needs both intervals: {len(has_neither)}")
        output_lines.append("")
        
        if needs_1m:
            output_lines.append("=" * 80)
            output_lines.append(f"Tokens needing 1m interval ({len(needs_1m)} tokens):")
            output_lines.append("=" * 80)
            for item in needs_1m[:50]:  # Show first 50
                output_lines.append(f"  {item['mint']:<50} (1m: {item['count_1m']:>6}, 5m: {item['count_5m']:>6})")
            if len(needs_1m) > 50:
                output_lines.append(f"  ... and {len(needs_1m) - 50} more")
            output_lines.append("")
        
        if needs_5m:
            output_lines.append("=" * 80)
            output_lines.append(f"Tokens needing 5m interval ({len(needs_5m)} tokens):")
            output_lines.append("=" * 80)
            for item in needs_5m[:50]:  # Show first 50
                output_lines.append(f"  {item['mint']:<50} (1m: {item['count_1m']:>6}, 5m: {item['count_5m']:>6})")
            if len(needs_5m) > 50:
                output_lines.append(f"  ... and {len(needs_5m) - 50} more")
            output_lines.append("")
        
        if has_neither:
            output_lines.append("=" * 80)
            output_lines.append(f"Tokens needing both intervals ({len(has_neither)} tokens):")
            output_lines.append("=" * 80)
            for item in has_neither[:50]:  # Show first 50
                output_lines.append(f"  {item['mint']:<50} (1m: {item['count_1m']:>6}, 5m: {item['count_5m']:>6})")
            if len(has_neither) > 50:
                output_lines.append(f"  ... and {len(has_neither) - 50} more")
            output_lines.append("")
    
    # Output to file or stdout
    output_text = "\n".join(output_lines)
    if output_file:
        with open(output_file, 'w') as f:
            f.write(output_text)
        print(f"Worklist saved to {output_file}", file=sys.stderr)
    else:
        print(output_text)

except Exception as e:
    print(f"ERROR: {str(e)}", file=sys.stderr)
    import traceback
    traceback.print_exc(file=sys.stderr)
    sys.exit(1)
PYTHON_EOF

