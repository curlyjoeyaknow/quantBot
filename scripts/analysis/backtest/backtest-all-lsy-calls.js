const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const axios = require('axios');

const LSY_CALLS_CSV = path.join(__dirname, '../data/exports/csv/lsy_calls.csv');
const OUTPUT_JSON = path.join(__dirname, '../data/exports/lsy_backtest_results.json');

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
const BIRDEYE_BASE = 'https://public-api.birdeye.so';

const DEFAULT_STRATEGY = [
  { percent: 0.5, target: 2 },
  { percent: 0.3, target: 5 },
  { percent: 0.2, target: 10 },
];

/**
 * Fetch OHLCV data from Birdeye
 */
async function fetchOHLCV(address, startTime, endTime, chain) {
  try {
    const start = Math.floor(new Date(startTime).getTime() / 1000);
    const end = Math.floor(new Date(endTime).getTime() / 1000);
    
    const url = `${BIRDEYE_BASE}/defi/history_price?address=${address}&address_type=token&type=1m&time_from=${start}&time_to=${end}`;
    
    const response = await axios.get(url, {
      headers: { 
        'X-API-KEY': BIRDEYE_API_KEY,
        'x-chain': chain === 'solana' ? 'solana' : chain
      }
    });
    
    return response.data?.items || [];
  } catch (error) {
    console.error(`Error fetching OHLCV: ${error.message}`);
    return [];
  }
}

/**
 * Simulate strategy
 */
function simulateStrategy(candles, entryPrice) {
  if (!candles || candles.length === 0) return null;
  
  let remaining = 1.0;
  let totalPnl = 0;
  const events = [];
  
  // Find target prices
  const targets = DEFAULT_STRATEGY.map(s => ({
    percent: s.percent,
    target: s.target,
    price: entryPrice * s.target,
    hit: false
  }));
  
  for (const candle of candles) {
    // Check for take profits
    for (const target of targets) {
      if (!target.hit && candle.high >= target.price) {
        const pnl = (entryPrice * target.target - entryPrice) / entryPrice * target.percent;
        totalPnl += pnl;
        remaining -= target.percent;
        target.hit = true;
        events.push({ type: 'take_profit', target: target.target, percent: target.percent });
        break;
      }
    }
    
    // Check for stop loss at -30%
    if (remaining > 0 && candle.low <= entryPrice * 0.7) {
      const stopLossPrice = entryPrice * 0.7;
      const pnl = (stopLossPrice - entryPrice) / entryPrice * remaining;
      totalPnl += pnl;
      remaining = 0;
      events.push({ type: 'stop_loss', price: stopLossPrice });
      break;
    }
    
    if (remaining <= 0) break;
  }
  
  if (remaining > 0) {
    const finalPrice = candles[candles.length - 1].close;
    totalPnl += (finalPrice - entryPrice) / entryPrice * remaining;
  }
  
  return { finalPnl: totalPnl, events, finalPrice: candles[candles.length - 1].close };
}

/**
 * Get entry price at -30% from alert
 */
function getEntryPrice(alertPrice, candles) {
  // Start 30% below alert
  const targetEntry = alertPrice * 0.7;
  
  // Find the first candle that touches or goes below this level
  for (let i = 0; i < candles.length; i++) {
    if (candles[i].low <= targetEntry) {
      return Math.min(candles[i].low, targetEntry);
    }
  }
  
  // If price never drops to -30%, return the lowest price
  const lowest = Math.min(...candles.map(c => c.low));
  return lowest;
}

/**
 * Main function
 */
async function backtestAllLSYCalls() {
  console.log('🚀 Starting backtest for all LSY calls...\n');

  // Read LSY calls
  const csv = fs.readFileSync(LSY_CALLS_CSV, 'utf8');
  const records = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });

  // Filter valid records
  const validRecords = records.filter(r => !r.tokenAddress.includes('4444'));
  console.log(`📊 Found ${validRecords.length} valid LSY calls\n`);

  const results = [];

  for (let i = 0; i < validRecords.length; i++) {
    const call = validRecords[i];
    
    console.log(`[${i + 1}/${validRecords.length}] Processing: ${call.tokenAddress.substring(0, 30)}...`);
    
    try {
      // Convert the timestamp to proper date
      const alertDate = new Date(call.timestamp);
      const endDate = new Date(alertDate.getTime() + 7 * 24 * 60 * 60 * 1000);
      
      console.log(`  📅 ${alertDate.toISOString()} - ${endDate.toISOString()}`);
      
      // Fetch candles
      const candles = await fetchOHLCV(call.tokenAddress, alertDate, endDate, call.chain);
      
      console.log(`  📊 Got ${candles.length} candles`);
      
      if (candles.length === 0) {
        console.log('  ⚠️ No candles');
        results.push({
          address: call.tokenAddress,
          timestamp: call.timestamp,
          chain: call.chain,
          success: false,
          error: 'No candles available'
        });
        continue;
      }
      
      // Get alert price (first candle close)
      const alertPrice = candles[0].close;
      
      // Get entry price at -30% from alert
      const entryPrice = getEntryPrice(alertPrice, candles);
      
      // Only proceed if price actually drops to -30%
      const dropPercent = ((entryPrice / alertPrice - 1) * 100).toFixed(1);
      if (entryPrice > alertPrice * 0.7) {
        console.log(`  ❌ Never dropped to -30% (only ${dropPercent}%)`);
        results.push({
          address: call.tokenAddress,
          timestamp: call.timestamp,
          chain: call.chain,
          alertPrice,
          entryPrice,
          dropPercent: parseFloat(dropPercent),
          success: false,
          error: 'Price never dropped to -30%',
          finalPnl: 0.95 // Assumed worst case
        });
        continue;
      }
      
      // Run simulation
      const result = simulateStrategy(candles, entryPrice);
      
      if (result) {
        console.log(`  ✅ PNL: ${result.finalPnl.toFixed(2)}x (${dropPercent}% drop)`);
        results.push({
          address: call.tokenAddress,
          timestamp: call.timestamp,
          chain: call.chain,
          alertPrice,
          entryPrice,
          finalPrice: result.finalPrice,
          dropPercent: parseFloat(dropPercent),
          pnl: result.finalPnl,
          multiplier: (result.finalPrice / entryPrice).toFixed(2),
          takeProfits: result.events.filter(e => e.type === 'take_profit').length,
          success: true
        });
      }
      
      await new Promise(r => setTimeout(r, 1500));
      
    } catch (error) {
      console.error(`  ❌ Error: ${error.message}`);
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
  const totalPnl = successful.reduce((sum, r) => sum + r.pnl, 0);
  const avgPnl = successful.length > 0 ? totalPnl / successful.length : 0;
  
  console.log(`\n✅ Complete!`);
  console.log(`📊 Successful: ${successful.length}/${results.length}`);
  console.log(`💰 Total PNL: ${totalPnl.toFixed(2)}x`);
  console.log(`📈 Average PNL: ${avgPnl.toFixed(2)}x`);
  console.log(`💾 Results saved to: ${OUTPUT_JSON}`);
}

backtestAllLSYCalls().catch(console.error);

