import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../src/simulation/candles';
import { simulateStrategy } from '../src/simulation/engine';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';

const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');

async function testReentryTargets() {
  console.log('🧪 Testing Re-entry with Different Profit Targets...\n');

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

  const targets = [2, 3, 4, 5, 7, 10];
  const results: any = {};

  for (const target of targets) {
    results[`reentry-${target}x`] = { winners: 0, losers: 0, netPnl: 0 };
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

      for (const target of targets) {
        // Set strategy: 100% at target
        const STRATEGY = [{ percent: 1.0, target }];
        
        // Configure stop loss: -30%
        const stopLossConfig = {
          initial: -0.3,
          trailing: 'none' as const
        };

        // Configure re-entry at alert bounce (70% retrace = back to alert price)
        const reEntryConfig = {
          trailingReEntry: 0.7,
          maxReEntries: 1,
          sizePercent: 0.5
        };

        const result = simulateStrategy(
          candles,
          STRATEGY,
          stopLossConfig,
          undefined,
          reEntryConfig
        );

        const pnl = result.finalPnl;
        
        if (pnl > 1) {
          results[`reentry-${target}x`].winners++;
          results[`reentry-${target}x`].netPnl += (pnl - 1);
        } else {
          results[`reentry-${target}x`].losers++;
          results[`reentry-${target}x`].netPnl += (pnl - 1);
        }
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
  console.log('Re-entry Strategy | Winners | Losers | Net PNL');
  console.log('------------------|---------|--------|---------');
  
  for (const target of targets) {
    const r = results[`reentry-${target}x`];
    const netPnl = r.netPnl.toFixed(2);
    const label = `TP @ ${target}x`.padEnd(17);
    console.log(`${label} | ${String(r.winners).padStart(7)} | ${String(r.losers).padStart(6)} | ${netPnl.padStart(7)}x`);
  }
}

testReentryTargets().catch(console.error);

