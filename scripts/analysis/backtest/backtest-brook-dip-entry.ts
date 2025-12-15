import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../src/simulation/candles';
import { simulateStrategy } from '../src/simulation/engine';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';

const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');
const OUTPUT_JSON = path.join(__dirname, '../data/exports/brook_dip_entry_results.json');

const STRATEGY = [
  { percent: 0.5, target: 2 },
  { percent: 0.3, target: 5 },
  { percent: 0.2, target: 10 },
];

const STOP_LOSS = { initial: -0.3, trailing: 'none' as const };

async function backtestDipEntry() {
  console.log('🚀 Testing Dip Entry Strategy (-30% dip, then -30% stop)...\n');

  // Read Brook calls
  const csv = fs.readFileSync(BROOK_CALLS_CSV, 'utf8');
  const records = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });

  // Filter for Brook calls only
  const brookOnly = (records as any[]).filter(
    (r: any) =>
      r.sender &&
      (r.sender.includes('Brook') ||
        r.sender.includes('brook') ||
        r.sender.includes('Brook Giga')) &&
      !r.tokenAddress.includes('bonk') &&
      r.tokenAddress.length > 20
  );

  console.log(`📊 Found ${brookOnly.length} Brook calls\n`);

  const results = [];
  let successCount = 0;

  for (let i = 0; i < brookOnly.length && i < 100; i++) {
    const call = brookOnly[i];

    if (i % 10 === 0) console.log(`\n[${i}/${Math.min(brookOnly.length, 100)}] Processing...`);

    try {
      // Parse timestamp
      const alertDate = DateTime.fromISO(call.timestamp);
      if (!alertDate.isValid) {
        console.log(`  ⚠️  Invalid timestamp for ${call.tokenAddress.substring(0, 30)}`);
        results.push({
          address: call.tokenAddress,
          timestamp: call.timestamp,
          success: false,
          error: 'Invalid timestamp',
        });
        continue;
      }

      // Fetch candles
      const endDate = alertDate.plus({ days: 60 });
      // Pass alertDate as alertTime for 1m candles around alert time
      const candles = await fetchHybridCandles(
        call.tokenAddress,
        alertDate,
        endDate,
        call.chain,
        alertDate
      );

      if (!candles || candles.length === 0) {
        results.push({
          address: call.tokenAddress,
          timestamp: call.timestamp,
          chain: call.chain,
          success: false,
          error: 'No candles available',
        });
        continue;
      }

      // Get alert price (first candle close)
      const alertPrice = candles[0].close;

      // NEW: Wait for -30% dip, then enter
      // Find first candle where price drops to 70% of alert
      const targetEntryPrice = alertPrice * 0.7;
      let entryCandleIndex = -1;

      for (let j = 1; j < candles.length; j++) {
        if (candles[j].low <= targetEntryPrice) {
          entryCandleIndex = j;
          break;
        }
      }

      if (entryCandleIndex === -1) {
        // Price never dipped to -30%, skip this trade
        results.push({
          address: call.tokenAddress,
          timestamp: call.timestamp,
          chain: call.chain,
          alertPrice,
          success: true,
          pnl: 1.0,
          multiplier: 1.0,
          events: [{ type: 'no_dip', message: 'Never reached -30% entry level' }],
          candles: candles.length,
        });
        continue;
      }

      // Get entry candles (everything after the dip entry point)
      const entryCandles = candles.slice(entryCandleIndex);
      const entryPrice = entryCandles[0].close;

      // Simulate from the entry point
      const result = simulateStrategy(entryCandles, STRATEGY, STOP_LOSS, undefined, {
        trailingReEntry: 'none',
        maxReEntries: 0,
        sizePercent: 0.5,
      });

      // Calculate multiplier from alert and final price
      const finalMultiplier = result.finalPrice / alertPrice;

      results.push({
        address: call.tokenAddress,
        timestamp: call.timestamp,
        chain: call.chain,
        alertPrice,
        entryPrice,
        entryCandleIndex,
        finalPrice: result.finalPrice,
        pnl: result.finalPnl,
        multiplier: finalMultiplier,
        events: result.events.length,
        candles: entryCandles.length,
        success: true,
      });

      successCount++;
    } catch (error: any) {
      console.log(`  ❌ Error: ${error.message}`);
      results.push({
        address: call.tokenAddress,
        timestamp: call.timestamp,
        chain: call.chain,
        success: false,
        error: error.message,
      });
    }
  }

  // Save results
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(results, null, 2));

  // Summary
  const successful = results.filter((r) => r.success);
  const winners = successful.filter((r) => (r.pnl || 0) > 1);
  const losers = successful.filter((r) => (r.pnl || 0) <= 1);

  const totalGain = winners.reduce((s, r) => s + ((r.pnl || 0) - 1), 0);
  const totalLoss = losers.reduce((s, r) => s + ((r.pnl || 0) - 1), 0);
  const netPnl = totalGain + totalLoss;
  const avgPnl =
    successful.length > 0
      ? successful.reduce((s, r) => s + (r.pnl || 0), 0) / successful.length
      : 0;

  console.log(`\n\n✅ Complete!`);
  console.log(`📊 Processed: ${successful.length}/${results.length}`);
  console.log(
    `📉 Never dipped -30% (skipped): ${successful.filter((r) => r.multiplier === 1.0).length}`
  );
  console.log(`🎯 Winners (>1x): ${winners.length}`);
  console.log(`❌ Losers (<=1x): ${losers.length}`);
  console.log(`💰 Net PNL: ${netPnl.toFixed(2)}x`);
  console.log(`📈 Average: ${avgPnl.toFixed(2)}x`);
  console.log(`💾 Results saved to: ${OUTPUT_JSON}`);
}

backtestDipEntry().catch(console.error);
