import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../src/simulation/candles';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import * as path from 'path';

const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');

function simulateConditionalReentry(
  candles: any[],
  strategy: any[]
): { pnl: number, maxReached: number, events: string[], exitPrice: number, exitReason: string } {
  
  const entryPrice = candles[0].close;
  const stopLoss = entryPrice * 0.7;
  
  let remaining = 1.0;
  let pnl = 0;
  let hitFirstTarget = false;
  let reEntered = false;
  let hitStopAfterTarget = false;
  let maxReached = 1;
  let exitPrice = 0;
  let exitReason = '';
  
  const events: string[] = [];
  
  for (const candle of candles) {
    // Track max reached
    if (candle.high / entryPrice > maxReached) {
      maxReached = candle.high / entryPrice;
    }
    
    // Check first profit target
    if (!hitFirstTarget && candle.high >= entryPrice * strategy[0].target) {
      const sellPercent = strategy[0].percent;
      pnl += sellPercent * strategy[0].target;
      remaining -= sellPercent;
      hitFirstTarget = true;
      events.push(`Hit ${strategy[0].target}x, sold ${sellPercent * 100}%`);
    }
    
    // After hitting first target, check for stop loss
    if (hitFirstTarget && !hitStopAfterTarget && candle.low <= stopLoss) {
      pnl += remaining * (stopLoss / entryPrice);
      exitPrice = stopLoss;
      exitReason = 'Stop loss';
      remaining = 0;
      hitStopAfterTarget = true;
      events.push(`Stop at 0.7x`);
    }
    
    // After being stopped out, check for bounce back to alert price
    if (hitStopAfterTarget && !reEntered && candle.high >= entryPrice) {
      remaining = 1.0;
      reEntered = true;
      events.push(`Re-entered on bounce to alert`);
    }
    
    // If re-entered, check for second profit target
    if (reEntered && remaining > 0 && strategy[1]) {
      const targetPrice = entryPrice * strategy[1].target;
      if (candle.high >= targetPrice) {
        pnl += remaining * strategy[1].target;
        exitPrice = targetPrice;
        exitReason = `Profit target ${strategy[1].target}x`;
        remaining = 0;
        events.push(`Hit ${strategy[1].target}x on re-entry`);
      }
    }
  }
  
  // Final exit if still holding
  if (remaining > 0) {
    exitPrice = candles[candles.length - 1].close;
    exitReason = 'Final candle close';
    pnl += remaining * (exitPrice / entryPrice);
    events.push(`Final exit at ${(exitPrice / entryPrice).toFixed(2)}x`);
  }
  
  return { pnl, maxReached, events, exitPrice: exitPrice / entryPrice, exitReason };
}

async function analyzeReentryMax() {
  console.log('🔍 Analyzing maximum multipliers reached...\n');

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
  
  const results: any[] = [];
  const maxCalls = 100;
  const totalCalls = Math.min(brookOnly.length, maxCalls);

  console.log(`📊 Processing ${totalCalls} calls...\n`);

  for (let i = 0; i < totalCalls; i++) {
    const call = brookOnly[i];
    process.stdout.write(`[${i+1}/${totalCalls}] Processing ${call.tokenAddress.substring(0, 20)}... `);
    
    try {
      const alertDate = DateTime.fromISO(call.timestamp);
      if (!alertDate.isValid) {
        console.log('❌ Invalid date');
        continue;
      }

      const endDate = alertDate.plus({ days: 60 });
      process.stdout.write('Fetching candles... ');
      const candles = await fetchHybridCandles(call.tokenAddress, alertDate, endDate, call.chain);
      if (!candles || candles.length === 0) {
        console.log('❌ No candles');
        continue;
      }
      process.stdout.write(`(${candles.length} candles) Simulating... `);

      const strategy = [
        { percent: 0.5, target: 2 },
        { percent: 0.5, target: 10 }
      ];

      const result = simulateConditionalReentry(candles, strategy);
      
      results.push({
        address: call.tokenAddress.substring(0, 20),
        pnl: result.pnl,
        maxReached: result.maxReached,
        hit2x: result.events.some(e => e.includes('2x')),
        reEntered: result.events.some(e => e.includes('Re-entered')),
        hit10x: result.events.some(e => e.includes('10x')),
        events: result.events,
        exitPrice: result.exitPrice,
        exitReason: result.exitReason
      });
      
      console.log(`✅ PNL: ${result.pnl.toFixed(2)}x | Max: ${result.maxReached.toFixed(2)}x`);
    } catch (error: any) {
      console.log(`❌ Error: ${error.message}`);
      continue;
    }
  }
  
  console.log(`\n✅ Completed processing ${results.length} valid calls\n`);

  console.log('Top 20 maximum multipliers reached:\n');
  const top20 = results
    .sort((a, b) => b.maxReached - a.maxReached)
    .slice(0, 20);
  
  top20.forEach((r, i) => {
    console.log(`${String(i+1).padStart(2)}. Max: ${r.maxReached.toFixed(2)}x | PNL: ${r.pnl.toFixed(2)}x | 2x:${r.hit2x?'✓':'✗'} Re-entered:${r.reEntered?'✓':'✗'} 10x:${r.hit10x?'✓':'✗'}`);
  });
  
  console.log(`\n🏆 Maximum reached: ${Math.max(...results.map(r => r.maxReached)).toFixed(2)}x`);
  
  // Aggregated totals
  const totalPnl = results.reduce((sum, r) => sum + r.pnl, 0);
  const avgPnl = totalPnl / results.length;
  const winners = results.filter(r => r.pnl > 1.0).length;
  const losers = results.filter(r => r.pnl < 1.0).length;
  const breakEven = results.filter(r => r.pnl === 1.0).length;
  const reEnteredCount = results.filter(r => r.reEntered).length;
  const hit10xCount = results.filter(r => r.hit10x).length;
  
  console.log(`\n📊 AGGREGATED PERFORMANCE:\n`);
  console.log(`   Total trades: ${results.length}`);
  console.log(`   Total PNL: ${totalPnl.toFixed(2)}x`);
  console.log(`   Average PNL: ${avgPnl.toFixed(2)}x`);
  console.log(`   Winners (>1.0x): ${winners} (${(winners/results.length*100).toFixed(1)}%)`);
  console.log(`   Losers (<1.0x): ${losers} (${(losers/results.length*100).toFixed(1)}%)`);
  console.log(`   Break-even: ${breakEven}`);
  console.log(`   Re-entered: ${reEnteredCount} (${(reEnteredCount/results.length*100).toFixed(1)}%)`);
  console.log(`   Hit 10x target: ${hit10xCount} (${(hit10xCount/results.length*100).toFixed(1)}%)`);
  
  // Debug top 3
  console.log('\n🔍 DEBUGGING TOP 3 TOKENS:\n');
  top20.slice(0, 3).forEach((r, i) => {
    console.log(`\n${i+1}. Max: ${r.maxReached.toFixed(2)}x | PNL: ${r.pnl.toFixed(2)}x`);
    console.log(`   Strategy: 50% @ 2x, then 50% @ 10x (on re-entry only)`);
    console.log(`   Events: ${r.events.join(' → ')}`);
    console.log(`   Re-entered: ${r.reEntered ? 'YES' : 'NO'}`);
    console.log(`   Exit: ${r.exitReason} at ${r.exitPrice.toFixed(2)}x`);
    console.log(`   Max reached: ${r.maxReached.toFixed(2)}x (but exited at ${r.exitPrice.toFixed(2)}x)`);
  });
}

analyzeReentryMax().catch(console.error);

