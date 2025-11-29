import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../src/simulation/candles';
import { simulateStrategy } from '../src/simulation/engine';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';

const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');
const OUTPUT_JSON = path.join(__dirname, '../data/exports/brook_backtest_results.json');

const STRATEGY = [
  { percent: 0.5, target: 2 },
  { percent: 0.3, target: 5 },
  { percent: 0.2, target: 10 },
];

const STOP_LOSS = { initial: -0.3, trailing: 'none' as const };

async function backtestBrookCalls() {
  console.log('🚀 Starting backtest for Brook/Whale calls...\n');

  // Read Brook calls
  const csv = fs.readFileSync(BROOK_CALLS_CSV, 'utf8');
  const records = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });

  // Filter for Brook calls only
  const brookOnly = (records as any[]).filter((r: any) => 
    r.sender && (
      r.sender.includes('Brook') || 
      r.sender.includes('brook') || 
      r.sender.includes('Brook Giga')
    ) && !r.tokenAddress.includes('bonk') && r.tokenAddress.length > 20
  );
  
  console.log(`📊 Found ${brookOnly.length} Brook calls\n`);

  const results = [];
  let successCount = 0;

  for (let i = 0; i < brookOnly.length && i < 100; i++) {
    const call = brookOnly[i];
    
    if (i % 10 === 0) console.log(`\n[${i}/${Math.min(brookOnly.length, 100)}] Processing...`);
    
    try {
      const alertDate = DateTime.fromISO(call.timestamp);
      const endDate = DateTime.utc();
      
      if (i % 10 === 0) console.log(`  📅 ${alertDate.toFormat('yyyy-MM-dd HH:mm')} - ${endDate.toFormat('yyyy-MM-dd HH:mm')}`);
      
      // Fetch candles using bot's infrastructure
      const candles = await fetchHybridCandles(call.tokenAddress, alertDate, endDate, call.chain);
      
      if (i % 10 === 0) console.log(`  📊 ${candles.length} candles`);
      
      if (candles.length === 0) {
        results.push({
          address: call.tokenAddress,
          timestamp: call.timestamp,
          chain: call.chain,
          success: false,
          error: 'No candles available'
        });
        continue;
      }

      // Use alert price as entry
      const entryPrice = candles[0].close;
      
      // Run simulation
      const result = simulateStrategy(candles, STRATEGY, STOP_LOSS);
      
      if (result) {
        successCount++;
        if (i % 10 === 0) {
          console.log(`  ✅ PNL: ${result.finalPnl.toFixed(2)}x`);
        }
        
        results.push({
          address: call.tokenAddress,
          timestamp: call.timestamp,
          chain: call.chain,
          entryPrice: entryPrice.toFixed(8),
          finalPrice: result.finalPrice.toFixed(8),
          pnl: parseFloat(result.finalPnl.toFixed(2)),
          multiplier: parseFloat((result.finalPrice / entryPrice).toFixed(2)),
          events: result.events.length,
          candles: candles.length,
          success: true
        });
      }
      
    } catch (error: any) {
      if (i % 10 === 0) {
        console.error(`  ❌ Error:`, error.message);
      }
      results.push({
        address: call.tokenAddress,
        timestamp: call.timestamp,
        chain: call.chain,
        success: false,
        error: error.message
      });
    }
  }

  // Save results
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(results, null, 2));
  
  // Summary
  const successful = results.filter(r => r.success);
  const winners = successful.filter(r => (r.pnl || 0) > 1);
  const losers = successful.filter(r => (r.pnl || 0) <= 1);
  
  const totalGain = winners.reduce((s, r) => s + ((r.pnl || 0) - 1), 0);
  const totalLoss = losers.reduce((s, r) => s + ((r.pnl || 0) - 1), 0);
  const netPnl = totalGain + totalLoss;
  const avgPnl = successful.length > 0 ? 
    successful.reduce((s, r) => s + (r.pnl || 0), 0) / successful.length : 0;
  
  console.log(`\n\n✅ Complete!`);
  console.log(`📊 Successful: ${successful.length}/${results.length}`);
  console.log(`🎯 Winners (>1x): ${winners.length}`);
  console.log(`❌ Losers (<=1x): ${losers.length}`);
  console.log(`💰 Net PNL: ${netPnl.toFixed(2)}x (${(netPnl * 100).toFixed(1)}%)`);
  console.log(`📈 Average: ${avgPnl.toFixed(2)}x`);
  console.log(`💾 Results saved to: ${OUTPUT_JSON}`);
}

backtestBrookCalls().catch(console.error);

