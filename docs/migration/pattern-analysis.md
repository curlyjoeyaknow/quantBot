# Pattern Analysis - Common Code Patterns Across Scripts

This document identifies duplicated logic, common patterns, and shared utilities across all simulation scripts.

## 1. CSV Loading Pattern (Used in 40+ scripts)

### Pattern A: Simple CSV Parse
```typescript
import { parse } from 'csv-parse';
import * as fs from 'fs';

const csv = fs.readFileSync(CSV_PATH, 'utf8');
const records: any[] = await new Promise((resolve, reject) => {
  parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
    if (err) reject(err);
    else resolve(records);
  });
});
```

### Pattern B: Manual CSV Parsing (Legacy)
```javascript
const csvContent = fs.readFileSync(INPUT_CSV_PATH, 'utf8');
const lines = csvContent.split('\n').filter(line => line.trim() !== '');
const headers = lines[0].split(',');
const records = lines.slice(1).map(line => {
  const values = line.split(',');
  let obj = {};
  headers.forEach((header, i) => {
    obj[header.trim()] = values[i] ? values[i].trim().replace(/"/g, '') : '';
  });
  return obj;
});
```

### Pattern C: CSV Validation
```javascript
const validRecords = records.filter(record => {
  const sender = record['Sender'] ? record['Sender'].trim() : '';
  const timestamp = record['Timestamp'];
  const address = record['Address'];
  return sender !== '' && 
         !/^\d{2}\.\d{2}\.\d{4}/.test(sender) && 
         timestamp && 
         address && 
         address !== 'N/A' &&
         !isNaN(new Date(timestamp));
});
```

**Files using this pattern:**
- `run-top-strategies-simulation.ts`
- `simulate-specific-strategies.ts`
- `optimize-strategies.ts`
- All scripts in `scripts/simulation/` directory
- `analyze-solana-callers-optimized.ts`

## 2. Candle Fetching Pattern (Used in 25+ scripts)

### Pattern A: Using fetchHybridCandles
```typescript
import { fetchHybridCandles } from '../src/simulation/candles';
import { DateTime } from 'luxon';

const alertTime = DateTime.fromISO(record.timestamp || record.alertTime);
const endTime = alertTime.plus({ days: 60 });
const candles = await fetchHybridCandles(tokenAddress, alertTime, endTime, chain);
```

### Pattern B: With Error Handling
```typescript
try {
  const candles = await fetchHybridCandles(tokenAddress, alertTime, endTime, chain);
  if (candles.length < 10) {
    skipped++;
    continue;
  }
  // Process candles
} catch (error: any) {
  skipped++;
  continue;
}
```

### Pattern C: With Progress Logging
```typescript
if ((i + 1) % 100 === 0) {
  console.log(`   Processing ${i + 1}/${records.length}... (processed: ${processed}, skipped: ${skipped})`);
}
```

**Files using this pattern:**
- `run-top-strategies-simulation.ts`
- `simulate-specific-strategies.ts`
- `calculate-portfolio-pnl.ts`
- `calculate-portfolio-pnl-by-caller.ts`
- `analyze-solana-callers-optimized.ts`

## 3. Strategy Simulation Pattern (Used in 20+ scripts)

### Pattern A: Basic Strategy Loop
```typescript
const entryPrice = candles[0].close;
let remaining = 1.0;
let pnl = 0;
let highestPrice = entryPrice;

for (const candle of candles) {
  // Check profit targets
  for (const target of strategy.profitTargets) {
    const targetPrice = entryPrice * target.target;
    if (remaining > 0 && candle.high >= targetPrice) {
      const sellPercent = Math.min(target.percent, remaining);
      pnl += sellPercent * target.target;
      remaining -= sellPercent;
    }
  }
  
  // Check stop loss
  if (remaining > 0 && candle.low <= stopLossPrice) {
    pnl += remaining * (stopLossPrice / entryPrice);
    remaining = 0;
    break;
  }
}

// Final exit
if (remaining > 0) {
  const finalPrice = candles[candles.length - 1].close;
  pnl += remaining * (finalPrice / entryPrice);
}
```

### Pattern B: With Trailing Stop
```typescript
let stopLoss = entryPrice * (1 - stopLossPercent);
let stopMovedToEntry = false;

for (const candle of candles) {
  // Trailing stop activation
  if (hasTrailing && !stopMovedToEntry) {
    const trailingTrigger = entryPrice * (1 + trailingStopActivation);
    if (candle.high >= trailingTrigger) {
      stopLoss = entryPrice; // Move to break-even
      stopMovedToEntry = true;
    }
  }
  
  // Update trailing stop
  if (stopMovedToEntry && remaining > 0) {
    const trailingStopPrice = highestPrice * (1 - trailingStopPercent);
    stopLoss = Math.max(stopLoss, trailingStopPrice);
  }
  
  // Check stop loss
  if (remaining > 0 && candle.low <= stopLoss) {
    pnl += remaining * (stopLoss / entryPrice);
    remaining = 0;
    break;
  }
}
```

**Files using this pattern:**
- `run-top-strategies-simulation.ts`
- `simulate-specific-strategies.ts`
- `optimize-strategies.ts`
- All test-*.ts scripts

## 4. Result Aggregation Pattern (Used in 15+ scripts)

### Pattern A: Basic Aggregation
```typescript
const tradeResults: TradeResult[] = [];
let processed = 0;
let skipped = 0;

for (const record of records) {
  try {
    const result = simulateStrategy(candles, strategy);
    tradeResults.push({
      timestamp: alertTime,
      pnl: result.pnl,
      address: tokenAddress,
      // ... other fields
    });
    processed++;
  } catch (error) {
    skipped++;
  }
}

// Calculate totals
const totalPnl = tradeResults.reduce((sum, t) => sum + (t.pnl - 1.0), 0);
const totalPnlPercent = tradeResults.length > 0 ? (totalPnl / tradeResults.length) * 100 : 0;
```

### Pattern B: With Metrics
```typescript
const winningTrades = tradeResults.filter(t => t.pnl > 1.0).length;
const losingTrades = tradeResults.length - winningTrades;
const winRate = tradeResults.length > 0 ? (winningTrades / tradeResults.length) * 100 : 0;
const avgWin = winningTrades > 0 
  ? tradeResults.filter(t => t.pnl > 1.0).reduce((sum, t) => sum + (t.pnl - 1), 0) / winningTrades 
  : 0;
const avgLoss = losingTrades > 0
  ? tradeResults.filter(t => t.pnl <= 1.0).reduce((sum, t) => sum + (1 - t.pnl), 0) / losingTrades
  : 0;
```

**Files using this pattern:**
- `run-top-strategies-simulation.ts`
- `optimize-strategies.ts`
- `aggregate-simulation-results.js`
- `analyze-strategy-results.ts`

## 5. CSV Output Pattern (Used in 30+ scripts)

### Pattern A: Using csv-stringify
```typescript
import { stringify } from 'csv-stringify';

const csvRows = tradeResults.map((trade, idx) => ({
  'Trade#': idx + 1,
  'Date': trade.timestamp.toFormat('yyyy-MM-dd'),
  'TokenAddress': trade.address,
  'PNL_Multiplier': trade.pnl.toFixed(4),
  // ... other fields
}));

await new Promise<void>((resolve, reject) => {
  stringify(csvRows, { header: true }, (err, output) => {
    if (err) reject(err);
    else {
      fs.writeFileSync(csvPath, output);
      resolve();
    }
  });
});
```

### Pattern B: Manual CSV Writing
```typescript
const header = 'scenario,mint,chain,start_time,end_time,entry_price,final_price,final_pnl,total_candles\n';
await fs.writeFile(filePath, header, 'utf-8');

for (const result of results) {
  const row = [
    result.scenario,
    result.mint,
    result.chain,
    result.startTime.toISO(),
    result.endTime.toISO(),
    result.entryPrice.toFixed(8),
    result.finalPrice.toFixed(8),
    result.finalPnl.toFixed(6),
    result.totalCandles.toString(),
  ].join(',');
  await fs.appendFile(filePath, `${row}\n`, 'utf-8');
}
```

**Files using this pattern:**
- `run-top-strategies-simulation.ts`
- `simulate-specific-strategies.ts`
- `optimize-strategies.ts`
- `generate-csv-summary.js`

## 6. Strategy Parameter Definition Pattern (Used in 10+ scripts)

### Pattern A: Strategy Interface
```typescript
interface StrategyParams {
  profitTargets: Array<{ target: number; percent: number }>;
  trailingStopPercent: number;
  trailingStopActivation: number;
  minExitPrice: number;
  name: string;
}
```

### Pattern B: Strategy Array
```typescript
const strategy: Array<{ percent: number; target: number }> = [
  { percent: 0.20, target: 2 },   // 20% @ 2x
  { percent: 0.20, target: 3 },   // 20% @ 3x
  { percent: 0.60, target: 5 },   // 60% @ 5x (with trailing stop)
];
```

### Pattern C: Complex Strategy Config
```typescript
interface StrategyConfig {
  name: string;
  holdHours: number;
  stopLossPercent: number;
  takeProfitPercent?: number;
  trailingStopPercent?: number;
  trailingStopActivation?: number;
  lossClampPercent?: number;
  buyTheDip?: {
    minDropPercent: number;
    reentryLevelPercent: number;
    maxWaitHours?: number;
  };
  delayedEntry?: {
    entryCondition: string;
    timeframe: string;
    maxWaitHours?: number;
  };
}
```

**Files using this pattern:**
- `analyze-solana-callers-optimized.ts` (100+ strategies)
- `optimize-strategies.ts`
- `run-top-strategies-simulation.ts`

## 7. ClickHouse Query Pattern (Used in 10+ scripts)

### Pattern A: Query Candles
```typescript
import { queryCandles } from '../src/storage/clickhouse-client';

const candles = await queryCandles(mint, chain, startTime, endTime);
```

### Pattern B: Check Data Exists
```typescript
import { hasCandles } from '../src/storage/clickhouse-client';

const hasData = await hasCandles(tokenAddress, alertTimestamp, endTime);
```

**Files using this pattern:**
- `analyze-solana-callers-optimized.ts`
- `generate-strategy-weekly-reports.ts`
- `generate-weekly-portfolio-reports.ts`

## 8. Progress Logging Pattern (Used in 20+ scripts)

### Pattern A: Simple Progress
```typescript
if ((i + 1) % 100 === 0) {
  console.log(`   Processing ${i + 1}/${total}...`);
}
```

### Pattern B: Detailed Progress
```typescript
if ((i + 1) % 100 === 0 || i === 0) {
  const progress = ((i + 1) / total) * 100;
  console.log(`   📊 Progress: ${i + 1}/${total} (${progress.toFixed(1)}%)`);
  console.log(`   Processed: ${processed}, Skipped: ${skipped}`);
}
```

### Pattern C: Per-Item Logging
```typescript
console.log(`\n[${i+1}/${total}] Processing ${tokenAddress.substring(0, 20)}...`);
console.log(`   Caller: ${caller}`);
console.log(`   Timestamp: ${timestamp}`);
console.log(`   ✅ Got ${candles.length} candles`);
console.log(`   ✅ Simulation complete: PNL=${result.pnl.toFixed(4)}x`);
```

**Files using this pattern:**
- Most simulation and optimization scripts

## 9. Error Handling Pattern (Used in 30+ scripts)

### Pattern A: Try-Catch with Skip
```typescript
try {
  const candles = await fetchHybridCandles(...);
  if (candles.length < 10) {
    skipped++;
    continue;
  }
  const result = simulateStrategy(candles, strategy);
  processed++;
} catch (error: any) {
  skipped++;
  continue;
}
```

### Pattern B: Error Logging
```typescript
try {
  // ... processing
} catch (error: any) {
  console.log(`❌ Error: ${error.message}`);
  skipped++;
  continue;
}
```

**Files using this pattern:**
- All scripts that process multiple items

## 10. Output Directory Management Pattern (Used in 15+ scripts)

### Pattern A: Timestamped Directories
```typescript
import { DateTime } from 'luxon';

const RUN_TIMESTAMP = DateTime.now().toFormat('yyyy-MM-dd_HH-mm-ss');
const RUN_OUTPUT_DIR = path.join(OUTPUT_DIR, RUN_TIMESTAMP);

if (!fs.existsSync(RUN_OUTPUT_DIR)) {
  fs.mkdirSync(RUN_OUTPUT_DIR, { recursive: true });
}
```

### Pattern B: Strategy-Specific Directories
```typescript
const safeName = strategy.name.replace(/[^a-zA-Z0-9_-]/g, '_');
const csvPath = path.join(OUTPUT_DIR, `${safeName}_trade_by_trade.csv`);
```

**Files using this pattern:**
- `analyze-solana-callers-optimized.ts`
- `optimize-strategies.ts`
- `run-top-strategies-simulation.ts`

## 11. Deduplication Pattern (Used in 5+ scripts)

### Pattern A: Unique Tokens
```typescript
const uniqueTokens = new Map<string, any>();
for (const record of allRecords) {
  const tokenAddress = record.tokenAddress || record.mint;
  const chain = record.chain || 'solana';
  const key = `${chain}:${tokenAddress}`;
  if (!uniqueTokens.has(key)) {
    uniqueTokens.set(key, record);
  }
}
const records = Array.from(uniqueTokens.values());
```

**Files using this pattern:**
- `run-top-strategies-simulation.ts`
- `simulate-specific-strategies.ts`

## 12. Metrics Calculation Pattern (Used in 10+ scripts)

### Pattern A: Basic Metrics
```typescript
const totalPnl = tradeResults.reduce((sum, t) => sum + (t.pnl - 1.0), 0);
const totalPnlPercent = tradeResults.length > 0 ? (totalPnl / tradeResults.length) * 100 : 0;
const winRate = tradeResults.length > 0 
  ? (tradeResults.filter(t => t.pnl > 1.0).length / tradeResults.length) * 100 
  : 0;
```

### Pattern B: Advanced Metrics
```typescript
const sharpeRatio = calculateSharpeRatio(returns);
const maxDrawdown = calculateMaxDrawdown(equityCurve);
const profitFactor = totalWins / Math.abs(totalLosses);
```

**Files using this pattern:**
- `optimize-strategies.ts`
- `analyze-strategy-results.ts`
- `calculate-portfolio-pnl.ts`

## Summary of Duplicated Code

1. **CSV Loading**: 40+ scripts have identical CSV parsing logic
2. **Candle Fetching**: 25+ scripts use the same fetchHybridCandles pattern
3. **Strategy Simulation**: 20+ scripts have similar simulation loops
4. **Result Aggregation**: 15+ scripts aggregate results the same way
5. **CSV Output**: 30+ scripts write CSV files identically
6. **Progress Logging**: 20+ scripts log progress the same way
7. **Error Handling**: 30+ scripts handle errors identically

## Recommendations

1. **Extract CSV Loader**: Create `CsvDataLoader` class
2. **Extract Candle Fetcher**: Already exists as `fetchHybridCandles`, but wrap in loader interface
3. **Extract Strategy Simulator**: Already exists as `simulateStrategy`, but needs better integration
4. **Extract Result Aggregator**: Create `ResultAggregator` class
5. **Extract CSV Writer**: Create `CsvWriter` class
6. **Extract Progress Logger**: Create `ProgressLogger` utility
7. **Extract Error Handler**: Create `ErrorHandler` utility

