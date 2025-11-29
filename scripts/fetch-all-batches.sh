#!/bin/bash
# Fetch all remaining tokens in batches of 100

export CLICKHOUSE_PASSWORD="UxdtDJVj"
export USE_CLICKHOUSE=true
export CLICKHOUSE_PORT=18123
export CLICKHOUSE_HOST=localhost
export CLICKHOUSE_USER=default
export BIRDEYE_API_KEY="8d0804d5859c4fac83ca5bc3a21daed2"

BATCH_NUM=4
START_TOKEN=341

echo "🚀 Starting continuous batch fetching..."
echo "This will fetch tokens in batches of 100 until all are processed"
echo ""

while true; do
  echo "📋 Getting next 100 tokens (batch $BATCH_NUM, starting from token $START_TOKEN)..."
  
  # Update list script to get next batch
  sed -i "s/slice(240, 340)/slice($((START_TOKEN-1)), $((START_TOKEN+99)))/" scripts/list-tokens-without-candles.ts
  sed -i "s/tokens 241-340/tokens $START_TOKEN-$((START_TOKEN+99))/" scripts/list-tokens-without-candles.ts
  sed -i "s/length >= 340/length >= $((START_TOKEN+99))/" scripts/list-tokens-without-candles.ts
  
  # Get token list
  ts-node scripts/list-tokens-without-candles.ts 2>&1 | tail -120 > /tmp/next-100-tokens-batch${BATCH_NUM}.txt
  
  # Check if we got 100 tokens
  TOKEN_COUNT=$(grep -c "^\s*[0-9]\+\.\s" /tmp/next-100-tokens-batch${BATCH_NUM}.txt || echo "0")
  
  if [ "$TOKEN_COUNT" -lt 50 ]; then
    echo "✅ No more tokens to fetch (only found $TOKEN_COUNT tokens)"
    break
  fi
  
  echo "   Found $TOKEN_COUNT tokens, updating fetch script..."
  
  # Update fetch script (using Python)
  python3 << PYEOF
import re

with open('/tmp/next-100-tokens-batch${BATCH_NUM}.txt', 'r') as f:
    lines = f.readlines()

tokens = []
for line in lines:
    match = re.match(r'\s*\d+\.\s+(\S+)\s+\((\w+)\)\s+-\s+(\d+)\s+to\s+(\d+)', line)
    if match:
        token_address, chain, unix_time, end_unix_time = match.groups()
        tokens.append({
            'tokenAddress': token_address.replace("'", "\\'"),
            'chain': chain,
            'unixTime': int(unix_time),
            'endUnixTime': int(end_unix_time)
        })

if len(tokens) == 0:
    print("No tokens found, stopping")
    exit(1)

# Read the current fetch script
with open('scripts/fetch-100-tokens.ts', 'r') as f:
    content = f.read()

# Find the tokensToFetch array and replace it
pattern = r'const tokensToFetch = \[.*?\];'
replacement = "const tokensToFetch = [\n" + ",\n".join([
    f"  {{ tokenAddress: '{t['tokenAddress']}', chain: '{t['chain']}', unixTime: {t['unixTime']}, endUnixTime: {t['endUnixTime']} }}"
    for t in tokens
]) + "\n];"

new_content = re.sub(pattern, replacement, content, flags=re.DOTALL)

# Write back
with open('scripts/fetch-100-tokens.ts', 'w') as f:
    f.write(new_content)

print(f"✅ Updated with {len(tokens)} tokens")
PYEOF

  if [ $? -ne 0 ]; then
    echo "❌ Failed to update fetch script, stopping"
    break
  fi
  
  echo "🚀 Starting batch $BATCH_NUM fetch..."
  ts-node scripts/fetch-100-tokens.ts > /tmp/fetch-100-tokens-batch${BATCH_NUM}.log 2>&1
  
  # Check results
  SUCCESS=$(grep -o "Success: [0-9]*" /tmp/fetch-100-tokens-batch${BATCH_NUM}.log | grep -o "[0-9]*" || echo "0")
  FAILED=$(grep -o "Failed: [0-9]*" /tmp/fetch-100-tokens-batch${BATCH_NUM}.log | grep -o "[0-9]*" || echo "0")
  
  echo "   Batch $BATCH_NUM complete: Success=$SUCCESS, Failed=$FAILED"
  echo ""
  
  BATCH_NUM=$((BATCH_NUM + 1))
  START_TOKEN=$((START_TOKEN + 100))
  
  # Small delay between batches
  sleep 2
done

echo "✅ All batches complete!"

