const fs = require('fs');
const path = require('path');
const axios = require('axios');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// Configuration
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
const OUTPUT_DIR = './brook_simulations';
const OHLCV_DIR = './brook_ohlcv';

// Ensure output directories exist
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}
if (!fs.existsSync(OHLCV_DIR)) {
  fs.mkdirSync(OHLCV_DIR, { recursive: true });
}

// Test with known working tokens and recent dates
const testTokens = [
  {
    address: 'So11111111111111111111111111111111111111112',
    chain: 'solana',
    name: 'Wrapped SOL',
    symbol: 'SOL',
    callTimestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 days ago
  },
  {
    address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    chain: 'solana', 
    name: 'USD Coin',
    symbol: 'USDC',
    callTimestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) // 5 days ago
  },
  {
    address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    chain: 'solana',
    name: 'Tether USD',
    symbol: 'USDT', 
    callTimestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) // 3 days ago
  }
];

// Default trading strategy
const DEFAULT_STRATEGY = [
  { percent: 0.25, target: 1.5 },  // 25% at 1.5x
  { percent: 0.25, target: 2.0 },   // 25% at 2x
  { percent: 0.25, target: 3.0 },   // 25% at 3x
  { percent: 0.25, target: 5.0 }    // 25% at 5x
];

const DEFAULT_STOP_LOSS = {
  initial: -0.3,  // -30% stop loss
  trailing: 0.5   // 50% trailing stop
};

/**
 * Fetch OHLCV candles from Birdeye (using correct API format)
 */
async function fetchOHLCVData(address, chain, startTime, endTime) {
  try {
    const response = await axios.get(`https://public-api.birdeye.so/defi/v3/ohlcv`, {
      headers: {
        'X-API-KEY': BIRDEYE_API_KEY,
        'accept': 'application/json',
        'x-chain': chain
      },
      params: {
        address,
        type: '5m',
        currency: 'usd',
        ui_amount_mode: 'raw',
        time_from: Math.floor(startTime.getTime() / 1000),
        time_to: Math.floor(endTime.getTime() / 1000),
        mode: 'range',
        padding: true,
        outlier: true
      }
    });

    if (response.data.success && response.data.data.items) {
      return response.data.data.items.map(item => ({
        timestamp: item.unix_time * 1000, // Convert to milliseconds
        open: parseFloat(item.o),
        high: parseFloat(item.h),
        low: parseFloat(item.l),
        close: parseFloat(item.c),
        volume: parseFloat(item.v)
      }));
    }
    return [];
  } catch (error) {
    console.error(`Error fetching OHLCV for ${address}:`, error.message);
    return [];
  }
}

/**
 * Find the closest candle to the call timestamp
 */
function findCallPrice(candles, callTimestamp) {
  if (!candles.length) return { price: 0, marketCap: 0 };

  // Find the candle closest to the call timestamp
  let closestCandle = candles[0];
  let minDiff = Math.abs(candles[0].timestamp - callTimestamp);

  for (const candle of candles) {
    const diff = Math.abs(candle.timestamp - callTimestamp);
    if (diff < minDiff) {
      minDiff = diff;
      closestCandle = candle;
    }
  }

  // Use the open price of the closest candle as the call price
  const callPrice = closestCandle.open;
  
  // Estimate market cap (this is approximate since we don't have total supply)
  const estimatedMarketCap = callPrice * 1000000; // Placeholder calculation

  return { price: callPrice, marketCap: estimatedMarketCap };
}

/**
 * Simple trading simulation (simplified version of the main simulation)
 */
function runTradingSimulation(candles, callPrice, strategy, stopLossConfig) {
  if (!candles.length || callPrice <= 0) {
    return {
      finalPnl: 0,
      events: [],
      maxPrice: 0,
      maxPnl: 0,
      targetsHit: 0
    };
  }

  let pnl = 0;
  let remaining = 1;
  let targetIndex = 0;
  let stopLoss = callPrice * (1 + stopLossConfig.initial);
  let stopMovedToEntry = false;
  let maxPrice = callPrice;
  let maxPnl = 0;
  const events = [];

  // Entry event
  events.push({
    type: 'entry',
    timestamp: candles[0].timestamp,
    price: callPrice,
    description: `Entry at $${callPrice.toFixed(8)}`,
    remainingPosition: 1,
    pnlSoFar: 0
  });

  for (const candle of candles) {
    // Update max price
    if (candle.high > maxPrice) {
      maxPrice = candle.high;
    }

    // Check trailing stop activation
    if (!stopMovedToEntry && stopLossConfig.trailing !== 'none') {
      const trailingTrigger = callPrice * (1 + stopLossConfig.trailing);
      if (candle.high >= trailingTrigger) {
        stopLoss = callPrice;
        stopMovedToEntry = true;
        events.push({
          type: 'stop_moved',
          timestamp: candle.timestamp,
          price: candle.high,
          description: `Trailing stop activated at $${candle.high.toFixed(8)}`,
          remainingPosition: remaining,
          pnlSoFar: pnl
        });
      }
    }

    // Check stop loss
    if (candle.low <= stopLoss) {
      const stopPnl = remaining * (stopLoss / callPrice);
      pnl += stopPnl;
      events.push({
        type: 'stop_loss',
        timestamp: candle.timestamp,
        price: stopLoss,
        description: `STOP LOSS triggered at $${stopLoss.toFixed(8)}`,
        remainingPosition: 0,
        pnlSoFar: pnl
      });
      break;
    }

    // Check take-profit targets
    while (targetIndex < strategy.length && remaining > 0) {
      const { percent, target } = strategy[targetIndex];
      const targetPrice = callPrice * target;

      if (candle.high >= targetPrice) {
        const targetPnl = percent * target;
        pnl += targetPnl;
        remaining -= percent;
        targetIndex++;

        events.push({
          type: 'target_hit',
          timestamp: candle.timestamp,
          price: targetPrice,
          description: `Target ${target}x hit! Sold ${(percent * 100).toFixed(0)}%`,
          remainingPosition: remaining,
          pnlSoFar: pnl
        });

        // Update max PNL
        if (pnl > maxPnl) {
          maxPnl = pnl;
        }
      } else {
        break;
      }
    }

    // If all targets hit, exit
    if (remaining <= 0) {
      break;
    }
  }

  // Final exit if still holding
  if (remaining > 0) {
    const finalPrice = candles[candles.length - 1].close;
    const finalPnl = remaining * (finalPrice / callPrice);
    pnl += finalPnl;
    events.push({
      type: 'final_exit',
      timestamp: candles[candles.length - 1].timestamp,
      price: finalPrice,
      description: `Final exit: ${(remaining * 100).toFixed(0)}% at $${finalPrice.toFixed(8)}`,
      remainingPosition: 0,
      pnlSoFar: pnl
    });
  }

  return {
    finalPnl: pnl,
    events,
    maxPrice,
    maxPnl,
    targetsHit: targetIndex
  };
}

/**
 * Save OHLCV data to CSV file
 */
function saveOHLCVToCSV(candles, symbol, address, chain) {
  const filename = `${symbol}_${address.substring(0, 8)}_${chain}.csv`;
  const filepath = path.join(OHLCV_DIR, filename);

  const csvWriter = createCsvWriter({
    path: filepath,
    header: [
      { id: 'timestamp', title: 'Timestamp' },
      { id: 'datetime', title: 'DateTime' },
      { id: 'open', title: 'Open' },
      { id: 'high', title: 'High' },
      { id: 'low', title: 'Low' },
      { id: 'close', title: 'Close' },
      { id: 'volume', title: 'Volume' }
    ]
  });

  const records = candles.map(candle => ({
    timestamp: candle.timestamp,
    datetime: new Date(candle.timestamp).toISOString(),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume
  }));

  return csvWriter.writeRecords(records).then(() => {
    console.log(`✅ Saved OHLCV data to ${filename}`);
    return filepath;
  });
}

/**
 * Process a single test token
 */
async function processTestToken(token, index) {
  console.log(`\n🔄 Processing ${index + 1}: ${token.symbol} (${token.name})`);
  
  const address = token.address;
  const chain = token.chain;
  const callTimestamp = token.callTimestamp.getTime();
  
  // Calculate time range for OHLCV data (call time ± 24 hours)
  const startTime = new Date(callTimestamp - 24 * 60 * 60 * 1000);
  const endTime = new Date(callTimestamp + 24 * 60 * 60 * 1000);

  try {
    // Fetch OHLCV data
    console.log(`📊 Fetching OHLCV data for ${address}...`);
    const candles = await fetchOHLCVData(address, chain, startTime, endTime);
    
    if (!candles.length) {
      console.log(`❌ No OHLCV data found for ${address}`);
      return {
        'Token Name': token.name,
        'Token Symbol': token.symbol,
        'Address': address,
        'Chain': chain,
        'Call Timestamp': token.callTimestamp.toISOString(),
        'Updated Call Price': 'N/A',
        'Updated Market Cap': 'N/A',
        'OHLCV Candles': 0,
        'Simulation PNL': 'N/A',
        'Max Price': 'N/A',
        'Targets Hit': 0,
        'OHLCV File': 'N/A',
        'Error': 'No OHLCV data'
      };
    }

    // Find call price from candles
    const { price: callPrice, marketCap } = findCallPrice(candles, callTimestamp);
    
    // Save OHLCV to CSV
    const ohlcvFile = await saveOHLCVToCSV(candles, token.symbol, address, chain);
    
    // Run trading simulation
    console.log(`🎯 Running simulation with call price: $${callPrice.toFixed(8)}`);
    const simulation = runTradingSimulation(candles, callPrice, DEFAULT_STRATEGY, DEFAULT_STOP_LOSS);
    
    console.log(`📈 Simulation result: ${simulation.finalPnl.toFixed(3)}x PNL, ${simulation.targetsHit} targets hit`);
    
    return {
      'Token Name': token.name,
      'Token Symbol': token.symbol,
      'Address': address,
      'Chain': chain,
      'Call Timestamp': token.callTimestamp.toISOString(),
      'Updated Call Price': callPrice.toFixed(8),
      'Updated Market Cap': marketCap.toFixed(0),
      'OHLCV Candles': candles.length,
      'Simulation PNL': simulation.finalPnl.toFixed(3),
      'Max Price': simulation.maxPrice.toFixed(8),
      'Targets Hit': simulation.targetsHit,
      'OHLCV File': path.basename(ohlcvFile),
      'Error': null
    };

  } catch (error) {
    console.error(`❌ Error processing ${address}:`, error.message);
    return {
      'Token Name': token.name,
      'Token Symbol': token.symbol,
      'Address': address,
      'Chain': chain,
      'Call Timestamp': token.callTimestamp.toISOString(),
      'Updated Call Price': 'N/A',
      'Updated Market Cap': 'N/A',
      'OHLCV Candles': 0,
      'Simulation PNL': 'N/A',
      'Max Price': 'N/A',
      'Targets Hit': 0,
      'OHLCV File': 'N/A',
      'Error': error.message
    };
  }
}

/**
 * Main processing function
 */
async function main() {
  console.log('🚀 Starting Test Token Processing...');
  console.log(`📁 Output Directory: ${OUTPUT_DIR}`);
  console.log(`📁 OHLCV Directory: ${OHLCV_DIR}`);

  if (!BIRDEYE_API_KEY) {
    console.error('❌ BIRDEYE_API_KEY not found in environment variables');
    process.exit(1);
  }

  const results = [];

  // Process each test token
  for (let i = 0; i < testTokens.length; i++) {
    const result = await processTestToken(testTokens[i], i);
    results.push(result);
    
    // Add delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Save results to CSV
  const outputCsv = path.join(OUTPUT_DIR, `test_simulation_results_${new Date().toISOString().split('T')[0]}.csv`);
  const csvWriter = createCsvWriter({
    path: outputCsv,
    header: [
      { id: 'Token Name', title: 'Token Name' },
      { id: 'Token Symbol', title: 'Token Symbol' },
      { id: 'Address', title: 'Address' },
      { id: 'Chain', title: 'Chain' },
      { id: 'Call Timestamp', title: 'Call Timestamp' },
      { id: 'Updated Call Price', title: 'Updated Call Price' },
      { id: 'Updated Market Cap', title: 'Updated Market Cap' },
      { id: 'OHLCV Candles', title: 'OHLCV Candles' },
      { id: 'Simulation PNL', title: 'Simulation PNL' },
      { id: 'Max Price', title: 'Max Price' },
      { id: 'Targets Hit', title: 'Targets Hit' },
      { id: 'OHLCV File', title: 'OHLCV File' },
      { id: 'Error', title: 'Error' }
    ]
  });

  await csvWriter.writeRecords(results);
  
  console.log(`\n✅ Processing complete!`);
  console.log(`📊 Results saved to: ${outputCsv}`);
  console.log(`📁 OHLCV files saved to: ${OHLCV_DIR}`);
  
  // Summary statistics
  const successful = results.filter(r => r.Error === null).length;
  const failed = results.filter(r => r.Error !== null).length;
  const avgPnl = results
    .filter(r => r['Simulation PNL'] !== 'N/A')
    .reduce((sum, r) => sum + parseFloat(r['Simulation PNL']), 0) / successful;
  
  console.log(`\n📈 Summary:`);
  console.log(`   ✅ Successful: ${successful}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📊 Average PNL: ${avgPnl.toFixed(3)}x`);
}

// Run the main function
main().catch(console.error);
