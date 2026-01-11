#!/bin/bash
# Load OHLCV data using ClickHouse native CSV import

OHLCV_DIR="/home/memez/quantBot/data/raw/brook_ohlcv"
CONTAINER="quantbot_clickhouse_1"

echo "🔄 Loading OHLCV data into ClickHouse..."
echo ""

total=0
for csv_file in "$OHLCV_DIR"/*.csv; do
    filename=$(basename "$csv_file")
    
    # Parse filename: Symbol_Address_Chain.csv
    base="${filename%.csv}"
    IFS='_' read -ra PARTS <<< "$base"
    
    # Last part is chain, second to last is address
    chain="${PARTS[-1]}"
    address="${PARTS[-2]}"
    
    # Count lines (excluding header)
    count=$(tail -n +2 "$csv_file" | wc -l)
    
    echo -n "📊 $filename ($count rows)... "
    
    # Convert CSV to ClickHouse format and insert
    tail -n +2 "$csv_file" | awk -F',' -v addr="$address" -v ch="$chain" '{
        # Timestamp (ms to seconds), DateTime, Open, High, Low, Close, Volume
        ts = int($1 / 1000)
        dt = strftime("%Y-%m-%d %H:%M:%S", ts)
        printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n", addr, ch, dt, "5m", $3, $4, $5, $6, $7
    }' | docker exec -i "$CONTAINER" clickhouse-client --database quantbot --query "INSERT INTO ohlcv_candles (token_address, chain, timestamp, interval, open, high, low, close, volume) FORMAT TabSeparated"
    
    if [ $? -eq 0 ]; then
        echo "✅"
        total=$((total + count))
    else
        echo "❌"
    fi
done

echo ""
echo "📊 Total rows loaded: $total"
echo ""

# Verify
docker exec "$CONTAINER" clickhouse-client --database quantbot --query "SELECT count() as total, count(DISTINCT token_address) as tokens FROM ohlcv_candles"

