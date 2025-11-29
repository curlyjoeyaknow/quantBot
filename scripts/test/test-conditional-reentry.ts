import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../src/simulation/candles';
import { simulateStrategy } from '../src/simulation/engine';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';

const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');

/**
 * Custom simulation: Only re-enter if you already hit a profit target,
 * then it dumps below stop, then recovers back above stop
 */
function simulateConditionalReentry(
  candles: any[],
  strategy: any[],
  stopLossConfig: any
): { pnl: number, hitFirstTarget: boolean, reEntered: boolean } {
  
  const entryPrice = candles[0].close;
  const stopLoss = entryPrice * (1 + stopLossConfig.initial);
  
  let remaining = 1.0;
  let pnl = 0;
  let hitFirstTarget = false;
  let reEntered = false;
  let hitStopAfterTarget = false;
  
  for (const candle of candles) {
    // Check first profit target
    if (!hitFirstTarget && candle.high >= entryPrice * strategy[0].target) {
      const sellPercent = strategy[0].percent;
      pnl += sellPercent * strategy[0].target;
      remaining -= sellPercent;
      hitFirstTarget = true;
    }
    
    // After hitting first target, check for stop loss
    if (hitFirstTarget && !hitStopAfterTarget && candle.low <= stopLoss) {
      pnl += remaining * (stopLoss / entryPrice);
      remaining = 0;
      hitStopAfterTarget = true;
    }
    
    // After being stopped out (with previous profits), check for bounce back to alert price
    if (hitStopAfterTarget && !reEntered && candle.high >= entryPrice) {
      // Re-enter at bounce
      remaining = 1.0;
      reEntered = true;
    }
    
    // If re-entered, check for second profit target
    if (reEntered && remaining > 0 && strategy[1]) {
      const targetPrice = entryPrice * strategy[1].target;
      if (candle.high >= targetPrice) {
        pnl += remaining * strategy[1].target;
        remaining = 0;
      }
    }
  }
  
  // Final exit if still holding
  if (remaining > 0) {
    pnl += remaining * (candles[candles.length - 1].close / entryPrice);
  }
  
  return { pnl, hitFirstTarget, reEntered };
}

async function testConditionalReentry() {
  console.log('🧪 Testing Conditional Re-entry (only if hit 2x first)...\n');

  // Read Brook calls
  const csv = fs.readFileSync(BROOK_CALLS_CSV, 'utf8');
  const records = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });

  const brookOnly = (records as any[]).filter((r: any) => 
    r.sender && (
      r.sender.includes('Brook') || 
      r.sender.includes('brook') || 
      r.sender.includes('Brook Giga')
    ) && !r.tokenAddress.includes('bonk') && r.tokenAddress.length > 20
  );
  
  console.log(`📊 Testing ${brookOnly.length} Brook calls\n`);

  const strategies = [
    { name: '50% @ 2x, then 50% @ 5x on re-entry', strategy: [
      { percent: 0.5, target: 2 },
      { percent: 0.5, target: 5 }
    ]},
    { name: '50% @ 2x, then 50% @ 10x on re-entry', strategy: [
      { percent: 0.5, target: 2 },
      { percent: 0.5, target: 10 }
    ]},
    { name: '100% @ 2x, then 100% @ 3x on re-entry', strategy: [
      { percent: 1.0, target: 2 },
      { percent: 1.0, target: 3 }
    ]}
  ];

  const results: any = {};

  for (const strat of strategies) {
    results[strat.name] = { 
      winners: 0, 
      losers: 0, 
      netPnl: 0, 
      hitFirstTarget: 0,
      reEntered: 0
    };
  }

  let processed = 0;
  const maxCalls = 100;

  for (let i = 0; i < Math.min(brookOnly.length, maxCalls); i++) {
    const call = brookOnly[i];
    
    try {
      const alertDate = DateTime.fromISO(call.timestamp);
      if (!alertDate.isValid) continue;

      const endDate = alertDate.plus({ days: 60 });
      const candles = await fetchHybridCandles(call.tokenAddress, alertDate, endDate, call.chain);
      if (!candles || candles.length === 0) continue;

      for (const strat of strategies) {
        const stopLossConfig = {
          initial: -0.3,
          trailing: 'none' as const
        };

        const result = simulateConditionalReentry(
          candles,
          strat.strategy,
          stopLossConfig
        );

        const pnl = result.pnl;
        
        if (pnl > 1) {
          results[strat.name].winners++;
          results[strat.name].netPnl += (pnl - 1);
        } else {
          results[strat.name].losers++;
          results[strat.name].netPnl += (pnl - 1);
        }
        
        if (result.hitFirstTarget) results[strat.name].hitFirstTarget++;
        if (result.reEntered) results[strat.name].reEntered++;
      }
      
      processed++;
      if (processed % 10 === 0) {
        console.log(`Processed ${processed}/${Math.min(brookOnly.length, maxCalls)}...`);
      }
    } catch (error) {
      continue;
    }
  }

  console.log('\n📊 RESULTS:\n');
  console.log('Strategy                           | Win  | Loss | Net PNL | Hit 1st | Re-entered');
  console.log('-----------------------------------|------|------|---------|---------|-----------');
  
  for (const strat of strategies) {
    const r = results[strat.name];
    const netPnl = r.netPnl.toFixed(2);
    const label = strat.name.padEnd(34);
    console.log(`${label} | ${String(r.winners).padStart(4)} | ${String(r.losers).padStart(4)} | ${netPnl.padStart(7)}x | ${String(r.hitFirstTarget).padStart(7)} | ${String(r.reEntered).padStart(10)}`);
  }
}

testConditionalReentry().catch(console.error);

