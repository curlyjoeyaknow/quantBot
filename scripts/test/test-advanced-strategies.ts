import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../src/simulation/candles';
import { simulateStrategy } from '../src/simulation/engine';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';

const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');

async function testAdvancedStrategies() {
  console.log('🧪 Testing Advanced Strategies...\n');

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
    { name: '2x + re-entry alert bounce', target: 2, reentry: true, trailingStop: 'none' },
    { name: '2x + 10% trailing', target: 2, reentry: false, trailingStop: 0.1 },
    { name: '2x + 20% trailing', target: 2, reentry: false, trailingStop: 0.2 },
    { name: '2x + 30% trailing', target: 2, reentry: false, trailingStop: 0.3 },
    { name: '2x + 50% trailing', target: 2, reentry: false, trailingStop: 0.5 },
    { name: '5x + 10% trailing', target: 5, reentry: false, trailingStop: 0.1 },
    { name: '5x + 20% trailing', target: 5, reentry: false, trailingStop: 0.2 },
    { name: '5x + 30% trailing', target: 5, reentry: false, trailingStop: 0.3 },
  ];

  const results: any = {};

  for (const strat of strategies) {
    results[strat.name] = { 
      winners: 0, 
      losers: 0, 
      netPnl: 0, 
      total: 0,
      avgMaxDrawdown: 0,
      drawdowns: []
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

      const alertPrice = candles[0].close;

      for (const strat of strategies) {
        // Set strategy: 100% at target
        const STRATEGY = [{ percent: 1.0, target: strat.target }];
        
        // Configure stop loss
        const stopLossConfig = {
          initial: -0.3,
          trailing: (strat.trailingStop === 'none' ? 'none' : strat.trailingStop) as number | 'none'
        };

        // Configure re-entry (if specified)
        const reEntryConfig = strat.reentry ? {
          trailingReEntry: 0.7, // 70% retrace = bounce back to alert price
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
          stopLossConfig,
          undefined,
          reEntryConfig
        );

        // Calculate PNL
        const pnl = result.finalPnl;
        
        // Calculate max drawdown for winners that hit target
        let maxDrawdown = 0;
        if (pnl > 1 && result.events && result.events.length > 0) {
          // Find the first profit target event
          const profitEvent = result.events.find((e: any) => e.type === 'take_profit');
          if (profitEvent && result.entryOptimization) {
            const lowestPrice = result.entryOptimization.lowestPrice;
            const entryPrice = result.entryOptimization.actualEntryPrice;
            if (lowestPrice && entryPrice) {
              maxDrawdown = ((lowestPrice / entryPrice - 1) * 100);
            }
          }
          results[strat.name].drawdowns.push(Math.abs(maxDrawdown));
        }
        
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

  // Calculate average drawdown for each strategy
  for (const strat of strategies) {
    const r = results[strat.name];
    if (r.drawdowns.length > 0) {
      r.avgMaxDrawdown = r.drawdowns.reduce((a: number, b: number) => a + b, 0) / r.drawdowns.length;
    }
  }

  console.log('\n📊 RESULTS:\n');
  console.log('Strategy                    | Win | Loss | Net PNL  | Avg Drawdown');
  console.log('----------------------------|-----|------|----------|------------');
  
  for (const strat of strategies) {
    const r = results[strat.name];
    const netPnl = r.netPnl.toFixed(2);
    const avgDD = r.avgMaxDrawdown.toFixed(1);
    const label = strat.name.padEnd(27);
    console.log(`${label} | ${String(r.winners).padStart(3)} | ${String(r.losers).padStart(4)} | ${netPnl.padStart(7)}x | ${avgDD.padStart(8)}%`);
  }
}

testAdvancedStrategies().catch(console.error);

