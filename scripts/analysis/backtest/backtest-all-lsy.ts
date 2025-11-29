import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../src/simulation/candles';
import { simulateStrategy } from '../src/simulation/engine';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';

const LSY_CALLS_CSV = path.join(__dirname, '../data/exports/csv/lsy_calls.csv');
const OUTPUT_JSON = path.join(__dirname, '../data/exports/lsy_backtest_results.json');

const STRATEGY = [
  { percent: 0.5, target: 2 },
  { percent: 0.3, target: 5 },
  { percent: 0.2, target: 10 },
];

const STOP_LOSS = { initial: -1.0, trailing: 'none' as const }; // Basically no stop loss

async function backtestAllLSYCalls() {
  console.log('🚀 Starting backtest for all LSY calls using bot infrastructure...\n');

  // Read LSY calls
  const csv = fs.readFileSync(LSY_CALLS_CSV, 'utf8');
  const records = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });

  // Filter valid records
  const validRecords = (records as any[]).filter((r: any) => !r.tokenAddress.includes('4444'));
  console.log(`📊 Found ${validRecords.length} valid LSY calls\n`);

  const results = [];

  for (let i = 0; i < validRecords.length; i++) {
    const call = validRecords[i];
    
    console.log(`\n[${i + 1}/${validRecords.length}] ${call.tokenAddress.substring(0, 30)}...`);
    
    try {
      const alertDate = DateTime.fromISO(call.timestamp);
      const entryDate = alertDate.minus({ hours: 0 }); // Use alert time as entry
      const endDate = DateTime.utc();
      
      console.log(`  📅 Period: ${entryDate.toFormat('yyyy-MM-dd HH:mm')} - ${endDate.toFormat('yyyy-MM-dd HH:mm')}`);
      
      // Fetch candles using bot's infrastructure
      // Pass alertDate as alertTime for 1m candles around alert time
      const candles = await fetchHybridCandles(call.tokenAddress, entryDate, endDate, call.chain, alertDate);
      
      if (candles.length === 0) {
        console.log('  ⚠️ No candles available');
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
        console.log(`  ✅ PNL: ${result.finalPnl.toFixed(2)}x`);
        console.log(`  📊 Entry: $${entryPrice.toFixed(8)}, Final: $${result.finalPrice.toFixed(8)}`);
        
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
      console.error(`  ❌ Error:`, error.message);
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
  const totalPnl = successful.reduce((sum, r) => sum + (r.pnl || 0), 0);
  const avgPnl = successful.length > 0 ? totalPnl / successful.length : 0;
  
  console.log(`\n\n✅ Complete!`);
  console.log(`📊 Successful: ${successful.length}/${results.length}`);
  console.log(`💰 Total PNL: ${totalPnl.toFixed(2)}x`);
  console.log(`📈 Average PNL: ${avgPnl.toFixed(2)}x`);
  console.log(`💾 Results saved to: ${OUTPUT_JSON}`);
}

backtestAllLSYCalls().catch(console.error);

