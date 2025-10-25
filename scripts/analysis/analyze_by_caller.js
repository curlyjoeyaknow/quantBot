const fs = require('fs'); // File system module for file operations
const csv = require('csv-parser'); // To parse CSV input
const createCsvWriter = require('csv-writer').createObjectCsvWriter; // For writing CSV files

// List of allowed callers - Only these will be included in the analysis
const ALLOWED_CALLERS = [
  'Brook Giga I verify @BrookCalls',
  'RektBigHustla | @OurCryptoHood Owner',
  'davinch',
  'Croz',
  'JK -Whale',
  'meta maxist',
  'Brook',
  'exy'
];

// Default exit strategies - sell % of position at certain targets
const DEFAULT_STRATEGY = [
  { percent: 0.00, target: 1.5 }, // 0% sell at 1.5x (possibly for tracking, not sale)
  { percent: 0.50, target: 2.0 }  // 50% sell at 2x
];

const DEFAULT_STOP_LOSS = {
  initial: -0.5,     // -50% stop loss from entry
  trailing: 'none'   // No trailing stop by default
};

// Convert a timestamp string to a Date object
function parseTimestamp(timestamp) {
  try {
    return new Date(timestamp);
  } catch (error) {
    console.error(`Error parsing timestamp: ${timestamp}`, error);
    return null;
  }
}

// Get week number in the year for a given date
function getWeekNumber(date) {
  const startOfYear = new Date(date.getFullYear(), 0, 1); // Jan 1 of this year
  const days = Math.floor((date - startOfYear) / (24 * 60 * 60 * 1000)); // Days since Jan 1
  // Add one so week #1 contains Jan 1 (even if partial week), adjust for 'getDay'
  return Math.ceil((days + startOfYear.getDay() + 1) / 7);
}

// Get the label and start/end range for a week based on a date
function getWeekRange(date) {
  const weekNumber = getWeekNumber(date);
  const year = date.getFullYear();
  const startOfYear = new Date(year, 0, 1);
  // Start of the week (X weeks after Jan 1)
  const startOfWeek = new Date(startOfYear.getTime() + (weekNumber - 1) * 7 * 24 * 60 * 60 * 1000);
  // End of week is 6 days after start
  const endOfWeek = new Date(startOfWeek.getTime() + 6 * 24 * 60 * 60 * 1000);
  return {
    weekNumber,
    start: startOfWeek,
    end: endOfWeek,
    label: `Week ${weekNumber} (${startOfWeek.toISOString().split('T')[0]} to ${endOfWeek.toISOString().split('T')[0]})`
  };
}

// Grab token metadata from Birdeye API using mint address and chain
async function fetchTokenMetadata(mint, chain) {
  try {
    // Makes an HTTP GET request for metadata
    const response = await fetch(`https://public-api.birdeye.so/defi/v1/token_overview?address=${mint}&chain=${chain}`);
    const data = await response.json();
    // If found and looks valid, return object, else null
    if (data.success && data.data) {
      return {
        name: data.data.name || 'Unknown',
        symbol: data.data.symbol || 'Unknown',
        decimals: data.data.decimals || 18
      };
    }
    return null;
  } catch (error) {
    console.error(`Error fetching metadata for ${mint}:`, error);
    return null;
  }
}

// Fetches OHLCV candles via Birdeye for a time range
async function fetchOHLCVData(mint, chain, startTime, endTime) {
  try {
    // Timestamps as unix time in seconds
    const startUnix = Math.floor(startTime.getTime() / 1000);
    const endUnix = Math.floor(endTime.getTime() / 1000);

    // POST request for OHLCV candles, each candle is 5-min
    const response = await fetch(`https://public-api.birdeye.so/defi/v3/ohlcv`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        address: mint,
        chain: chain,
        type: '5m',
        currency: 'usd',
        mode: 'range',
        time_from: startUnix,
        time_to: endUnix,
        padding: true,
        outlier: true
      })
    });

    const data = await response.json();

    // If candles exist, map to cleaned array format
    if (data.success && data.data && data.data.items && data.data.items.length > 0) {
      return data.data.items.map(item => ({
        timestamp: item.unix_time * 1000,    // Convert unix seconds to JS ms
        open: parseFloat(item.o),            // Open price
        high: parseFloat(item.h),            // High price
        low: parseFloat(item.l),             // Low price
        close: parseFloat(item.c),           // Close price
        volume: parseFloat(item.v)           // Volume
      }));
    }
    return null;
  } catch (error) {
    console.error(`Error fetching OHLCV for ${mint}:`, error);
    return null;
  }
}

// Simulates the trading strategy on the candle series
function runTradingSimulation(candles, callPrice, strategy, stopLossConfig) {
  if (!candles || candles.length === 0) return null; // No data for simulation

  const hasTrailing = stopLossConfig.trailing && stopLossConfig.trailing !== 'none';

  // Entry is at -50% from call price (arbitrary simulation assumption)
  const entryPrice = callPrice * 0.5;
  let entryCandleIndex = -1;

  // Find first candle that touches or drops below entry price
  for (let i = 0; i < candles.length; i++) {
    if (candles[i].low <= entryPrice) {
      entryCandleIndex = i;
      break;
    }
  }

  // If entry never reached within candle data, return null (no trade)
  if (entryCandleIndex === -1) {
    return null; // Never reached entry price
  }

  // Actual entry is earliest of entry price vs candle open (in case of gap down)
  const actualEntryPrice = Math.min(entryPrice, candles[entryCandleIndex].open);

  let stopLoss = actualEntryPrice * (1 + stopLossConfig.initial); // ex: -50% means 0.5x entry price
  let remaining = 1.0; // Fraction of position remaining, initially 100%
  let pnl = 0; // Cumulative percent gain/loss (e.g. +0.25 is +25%)
  let stopMovedToEntry = false; // For tracking trailing stop activation

  // Step over candles after entry to simulate trade
  for (let i = entryCandleIndex; i < candles.length; i++) {
    const candle = candles[i];

    // Check if any take profit targets are met for remaining position
    for (const target of strategy) {
      // Only act if have unsold position and high reaches take profit threshold
      if (remaining > 0 && candle.high >= actualEntryPrice * target.target) {
        const sellAmount = remaining * target.percent;         // Sell X% of remaining position
        const sellPrice = actualEntryPrice * target.target;    // Price at which target triggers
        pnl += sellAmount * (target.target - 1);               // Add profit (fractional)
        remaining -= sellAmount;                               // Reduce position
      }
    }

    // If trailing stop used and not already moved, check for trigger
    if (hasTrailing && !stopMovedToEntry) {
      const trailingTrigger = actualEntryPrice * (1 + stopLossConfig.trailing);
      if (candle.high >= trailingTrigger) {
        stopLoss = actualEntryPrice;     // Move stop up to break even
        stopMovedToEntry = true;
      }
    }

    // If stop loss hit, sell all remaining at stop price and end trade
    if (remaining > 0 && candle.low <= stopLoss) {
      const stopPnl = remaining * (stopLoss / actualEntryPrice);
      pnl += stopPnl;
      remaining = 0;
      break;
    }
  }

  return {
    entryPrice: actualEntryPrice,
    finalPnl: pnl,
    remainingPosition: remaining,
    stopLossHit: remaining === 0
  };
}

// Processes a single CA drop row: fetches data, simulates trade, returns results
async function processCADrop(row) {
  // Progress feedback for user
  console.log(`Processing ${row['Token Name']} (${row['Token Symbol']}) by ${row.Sender}`);

  const callTimestamp = parseTimestamp(row.Timestamp); // Get call time as Date object
  if (!callTimestamp) return null;

  // Fetch Birdeye token info
  const metadata = await fetchTokenMetadata(row.Address, row.Chain);
  if (!metadata) {
    console.log(`❌ Token ${row.Address} not found on Birdeye`);
    return null;
  }

  // Look 24 hours after call for candle pull
  const endTime = new Date(callTimestamp.getTime() + 24 * 60 * 60 * 1000);

  // Pull OHLCV candle history for this window
  const candles = await fetchOHLCVData(row.Address, row.Chain, callTimestamp, endTime);

  if (!candles || candles.length === 0) {
    console.log(`❌ No OHLCV data for ${row.Address}`);
    return null;
  }

  const callPrice = candles[0].open; // Assume first candle after drop is 'call price'

  // Simulate the strategy and collect resulting metrics
  const simulation = runTradingSimulation(candles, callPrice, DEFAULT_STRATEGY, DEFAULT_STOP_LOSS);

  if (!simulation) {
    console.log(`❌ No entry opportunity for ${row.Address}`);
    return null;
  }

  // Compute additional analytics metrics for this token
  const minPrice = Math.min(...candles.map(c => c.low));       // Lowest price reached
  const maxPrice = Math.max(...candles.map(c => c.high));      // Highest price in session

  // How bad the drop after call (relative to call price), in percent
  const entryRating = ((minPrice - callPrice) / callPrice) * 100;
  // Best possible gain (relative to call price), in percent
  const maxGain = ((maxPrice - callPrice) / callPrice) * 100;

  // Return all useful data for output
  return {
    token: metadata.name,
    symbol: metadata.symbol,
    mint: row.Address,
    chain: row.Chain,
    caller: row.Sender,
    callTimestamp: callTimestamp,
    callPrice: callPrice,
    entryPrice: simulation.entryPrice,
    stopLossPrice: simulation.entryPrice * 0.7, // Fixed 30% stop below entry
    minPrice: minPrice,
    maxPrice: maxPrice,
    entryRating: entryRating,
    maxGain: maxGain,
    stopLossHit: simulation.stopLossHit,
    finalPnl: simulation.finalPnl,
    candlesAfterCall: candles.length
  };
}

// Main orchestrator for reading CSV, running all analyses, and exporting summary files
async function analyzeByCaller() {
  console.log('🔍 Starting caller-specific analysis...');

  const results = {}; // Map of { caller: { weekKey: [results] } }
  const rows = [];    // List of all drops to process

  // Read CA drop data CSV and filter only allowed callers
  await new Promise((resolve, reject) => {
    fs.createReadStream('brook_ca_drops_2025-10-24.csv')
      .pipe(csv())
      .on('data', (row) => {
        if (ALLOWED_CALLERS.includes(row.Sender)) { // Only include whitelisted callers
          rows.push(row);
        }
      })
      .on('end', resolve)
      .on('error', reject);
  });

  console.log(`📊 Found ${rows.length} calls from allowed callers`);

  // For each row, process CA drop simulation and sort by week/caller
  for (const row of rows) {
    const result = await processCADrop(row);
    if (result) {
      const weekInfo = getWeekRange(result.callTimestamp); // Find week range label
      const weekKey = weekInfo.label;

      // Ensure structure exists for caller/week
      if (!results[result.caller]) {
        results[result.caller] = {};
      }
      if (!results[result.caller][weekKey]) {
        results[result.caller][weekKey] = [];
      }

      // Store analyzed call result
      results[result.caller][weekKey].push(result);
    }

    // Insert a small delay each iteration to avoid being rate-limited by Birdeye API
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Export a CSV file per caller and a summary stats file per caller
  for (const [caller, weeks] of Object.entries(results)) {
    console.log(`\n📈 Processing ${caller}...`);

    const allResults = [];         // Will collect all analyzed CA drops for caller
    let totalCalls = 0;
    let totalProfitable = 0;
    let totalStopLossHit = 0;
    let totalPnl = 0;
    let totalEntryRating = 0;

    // Aggregate per-week results and compute overall stats
    for (const [week, calls] of Object.entries(weeks)) {
      console.log(`  Week: ${week} - ${calls.length} calls`);

      for (const call of calls) {
        allResults.push({
          ...call,
          week: week
        });

        totalCalls++;
        if (call.finalPnl > 0) totalProfitable++;      // Winning trades
        if (call.stopLossHit) totalStopLossHit++;      // Stopped out trades
        totalPnl += call.finalPnl;                     // Sum percent profit-loss
        totalEntryRating += call.entryRating;          // Sum for average
      }
    }

    // Compute summary analytics for the caller
    const avgPnl = totalCalls > 0 ? totalPnl / totalCalls : 0;
    const successRate = totalCalls > 0 ? (totalProfitable / totalCalls) * 100 : 0;
    const stopLossRate = totalCalls > 0 ? (totalStopLossHit / totalCalls) * 100 : 0;
    const avgEntryRating = totalCalls > 0 ? totalEntryRating / totalCalls : 0;

    // Export per-call details to a CSV file (one row per trade)
    const csvWriter = createCsvWriter({
      path: `caller_analysis_${caller.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`,
      header: [
        {id: 'token', title: 'Token'},
        {id: 'symbol', title: 'Symbol'},
        {id: 'mint', title: 'Mint Address'},
        {id: 'chain', title: 'Chain'},
        {id: 'week', title: 'Week'},
        {id: 'callTimestamp', title: 'Call Timestamp'},
        {id: 'callPrice', title: 'Call Price'},
        {id: 'entryPrice', title: 'Entry Price'},
        {id: 'stopLossPrice', title: 'Stop Loss Price'},
        {id: 'minPrice', title: 'Min Price'},
        {id: 'maxPrice', title: 'Max Price'},
        {id: 'entryRating', title: 'Entry Rating %'},
        {id: 'maxGain', title: 'Max Gain %'},
        {id: 'stopLossHit', title: 'Stop Loss Hit'},
        {id: 'finalPnl', title: 'Final PNL %'},
        {id: 'candlesAfterCall', title: 'Candles After Call'}
      ]
    });

    await csvWriter.writeRecords(allResults);

    // Write summary stats for caller to CSV (one summary row per metric)
    const summaryWriter = createCsvWriter({
      path: `caller_summary_${caller.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`,
      header: [
        {id: 'metric', title: 'Metric'},
        {id: 'value', title: 'Value'}
      ]
    });

    await summaryWriter.writeRecords([
      {metric: 'Total Calls', value: totalCalls},
      {metric: 'Profitable Calls', value: totalProfitable},
      {metric: 'Success Rate %', value: successRate.toFixed(2)},
      {metric: 'Stop Loss Hit', value: totalStopLossHit},
      {metric: 'Stop Loss Rate %', value: stopLossRate.toFixed(2)},
      {metric: 'Average PNL %', value: avgPnl.toFixed(2)},
      {metric: 'Average Entry Rating %', value: avgEntryRating.toFixed(2)},
      {metric: 'Total PNL %', value: totalPnl.toFixed(2)}
    ]);

    console.log(`✅ Exported ${caller}: ${totalCalls} calls, ${successRate.toFixed(1)}% success rate`);
  }

  console.log('\n🎉 Analysis complete! Check the generated CSV files.');
}

// Entry point to the analysis, logs errors if thrown
analyzeByCaller().catch(console.error);
