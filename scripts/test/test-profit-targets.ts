import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../src/simulation/candles';
import { simulateStrategy } from '../src/simulation/engine';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';

const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');

const STOP_LOSS = { initial: -0.3, trailing: 'none' as const };

async function testProfitTargets() {
  console.log('🧪 Testing Different Profit Targets on Brook Calls...\n');

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
    { name: '2x target', target: 2, reentry: false },
    { name: '3x target', target: 3, reentry: false },
    { name: '4x target', target: 4, reentry: false },
    { name: '5x target', target: 5, reentry: false },
    { name: '7x target', target: 7, reentry: false },
    { name: '3x target + re-entry', target: 3, reentry: true },
  ];

  const results: any = {};

  for (const strat of strategies) {
    results[strat.name] = { winners: 0, losers: 0, netPnl: 0, total: 0 };
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

      const alertPrice = candles[0].close;

      for (const strat of strategies) {
        // Set strategy: 100% at target
        const STRATEGY = [{ percent: 1.0, target: strat.target }];
        
        // Configure re-entry
        const reEntryConfig = strat.reentry ? {
          trailingReEntry: 'none' as const,
          maxReEntries: 1,
          sizePercent: 0.5
        } : {
          trailingReEntry: 'none' as const,
          maxReEntries: 0,
          sizePercent: 0.5
        };

        const result = simulateStrategy(
          candles,
          STRATEGY,
          STOP_LOSS,
          undefined,
          reEntryConfig
        );

        // Calculate PNL
        const pnl = result.finalPnl;
        
        if (pnl > 1) {
          results[strat.name].winners++;
          results[strat.name].netPnl += (pnl - 1);
        } else {
          results[strat.name].losers++;
          results[strat.name].netPnl += (pnl - 1);
        }
        results[strat.name].total++;
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
  console.log('Strategy | Winners | Losers | Net PNL');
  console.log('--------|---------|--------|---------');
  
  for (const strat of strategies) {
    const r = results[strat.name];
    const netPnl = r.netPnl.toFixed(2);
    console.log(`${strat.name.padEnd(20)} | ${String(r.winners).padStart(7)} | ${String(r.losers).padStart(6)} | ${netPnl.padStart(7)}x`);
  }
}

testProfitTargets().catch(console.error);

