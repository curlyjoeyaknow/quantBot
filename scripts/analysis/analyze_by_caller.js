const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// Configuration
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

const DEFAULT_STRATEGY = [
  { percent: 0.00, target: 1.5 },
  { percent: 0.50, target: 2.0 }
];

const DEFAULT_STOP_LOSS = {
  initial: -0.5,
  trailing: 'none'
};

// Helper function to parse timestamp
function parseTimestamp(timestamp) {
  try {
    return new Date(timestamp);
  } catch (error) {
    console.error(`Error parsing timestamp: ${timestamp}`, error);
    return null;
  }
}

// Helper function to get week number
function getWeekNumber(date) {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date - startOfYear) / (24 * 60 * 60 * 1000));
  return Math.ceil((days + startOfYear.getDay() + 1) / 7);
}

// Helper function to get week range
function getWeekRange(date) {
  const weekNumber = getWeekNumber(date);
  const year = date.getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const startOfWeek = new Date(startOfYear.getTime() + (weekNumber - 1) * 7 * 24 * 60 * 60 * 1000);
  const endOfWeek = new Date(startOfWeek.getTime() + 6 * 24 * 60 * 60 * 1000);
  return {
    weekNumber,
    start: startOfWeek,
    end: endOfWeek,
    label: `Week ${weekNumber} (${startOfWeek.toISOString().split('T')[0]} to ${endOfWeek.toISOString().split('T')[0]})`
  };
}

// Fetch token metadata from Birdeye
async function fetchTokenMetadata(mint, chain) {
  try {
    const response = await fetch(`https://public-api.birdeye.so/defi/v1/token_overview?address=${mint}&chain=${chain}`);
    const data = await response.json();
    
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

// Fetch OHLCV data from Birdeye
async function fetchOHLCVData(mint, chain, startTime, endTime) {
  try {
    const startUnix = Math.floor(startTime.getTime() / 1000);
    const endUnix = Math.floor(endTime.getTime() / 1000);
    
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
    
    if (data.success && data.data && data.data.items && data.data.items.length > 0) {
      return data.data.items.map(item => ({
        timestamp: item.unix_time * 1000, // Convert to milliseconds
        open: parseFloat(item.o),
        high: parseFloat(item.h),
        low: parseFloat(item.l),
        close: parseFloat(item.c),
        volume: parseFloat(item.v)
      }));
    }
    return null;
  } catch (error) {
    console.error(`Error fetching OHLCV for ${mint}:`, error);
    return null;
  }
}

// Run trading simulation
function runTradingSimulation(candles, callPrice, strategy, stopLossConfig) {
  if (!candles || candles.length === 0) return null;
  
  const hasTrailing = stopLossConfig.trailing && stopLossConfig.trailing !== 'none';
  
  // Find entry point (-50% from call price)
  const entryPrice = callPrice * 0.5;
  let entryCandleIndex = -1;
  
  // Find first candle where price drops to entry level
  for (let i = 0; i < candles.length; i++) {
    if (candles[i].low <= entryPrice) {
      entryCandleIndex = i;
      break;
    }
  }
  
  if (entryCandleIndex === -1) {
    return null; // Never reached entry price
  }
  
  const actualEntryPrice = Math.min(entryPrice, candles[entryCandleIndex].open);
  let stopLoss = actualEntryPrice * (1 + stopLossConfig.initial);
  let remaining = 1.0; // 100% position
  let pnl = 0;
  let stopMovedToEntry = false;
  
  // Process candles after entry
  for (let i = entryCandleIndex; i < candles.length; i++) {
    const candle = candles[i];
    
    // Check for take profit targets
    for (const target of strategy) {
      if (remaining > 0 && candle.high >= actualEntryPrice * target.target) {
        const sellAmount = remaining * target.percent;
        const sellPrice = actualEntryPrice * target.target;
        pnl += sellAmount * (target.target - 1);
        remaining -= sellAmount;
      }
    }
    
    // Trailing stop check
    if (hasTrailing && !stopMovedToEntry) {
      const trailingTrigger = actualEntryPrice * (1 + stopLossConfig.trailing);
      if (candle.high >= trailingTrigger) {
        stopLoss = actualEntryPrice;
        stopMovedToEntry = true;
      }
    }
    
    // Stop loss check
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

// Process CA drop
async function processCADrop(row) {
  console.log(`Processing ${row['Token Name']} (${row['Token Symbol']}) by ${row.Sender}`);
  
  const callTimestamp = parseTimestamp(row.Timestamp);
  if (!callTimestamp) return null;
  
  // Fetch token metadata
  const metadata = await fetchTokenMetadata(row.Address, row.Chain);
  if (!metadata) {
    console.log(`❌ Token ${row.Address} not found on Birdeye`);
    return null;
  }
  
  // Calculate time range (call time + 24 hours)
  const endTime = new Date(callTimestamp.getTime() + 24 * 60 * 60 * 1000);
  
  // Fetch OHLCV data
  const candles = await fetchOHLCVData(row.Address, row.Chain, callTimestamp, endTime);
  if (!candles || candles.length === 0) {
    console.log(`❌ No OHLCV data for ${row.Address}`);
    return null;
  }
  
  // Find call price from first candle
  const callPrice = candles[0].open;
  
  // Run simulation
  const simulation = runTradingSimulation(candles, callPrice, DEFAULT_STRATEGY, DEFAULT_STOP_LOSS);
  if (!simulation) {
    console.log(`❌ No entry opportunity for ${row.Address}`);
    return null;
  }
  
  // Calculate additional metrics
  const minPrice = Math.min(...candles.map(c => c.low));
  const maxPrice = Math.max(...candles.map(c => c.high));
  const entryRating = ((minPrice - callPrice) / callPrice) * 100;
  const maxGain = ((maxPrice - callPrice) / callPrice) * 100;
  
  return {
    token: metadata.name,
    symbol: metadata.symbol,
    mint: row.Address,
    chain: row.Chain,
    caller: row.Sender,
    callTimestamp: callTimestamp,
    callPrice: callPrice,
    entryPrice: simulation.entryPrice,
    stopLossPrice: simulation.entryPrice * 0.7, // -30% from entry
    minPrice: minPrice,
    maxPrice: maxPrice,
    entryRating: entryRating,
    maxGain: maxGain,
    stopLossHit: simulation.stopLossHit,
    finalPnl: simulation.finalPnl,
    candlesAfterCall: candles.length
  };
}

// Main analysis function
async function analyzeByCaller() {
  console.log('🔍 Starting caller-specific analysis...');
  
  const results = {};
  const rows = [];
  
  // Read CSV file
  await new Promise((resolve, reject) => {
    fs.createReadStream('brook_ca_drops_2025-10-24.csv')
      .pipe(csv())
      .on('data', (row) => {
        if (ALLOWED_CALLERS.includes(row.Sender)) {
          rows.push(row);
        }
      })
      .on('end', resolve)
      .on('error', reject);
  });
  
  console.log(`📊 Found ${rows.length} calls from allowed callers`);
  
  // Process each row
  for (const row of rows) {
    const result = await processCADrop(row);
    if (result) {
      const weekInfo = getWeekRange(result.callTimestamp);
      const weekKey = weekInfo.label;
      
      if (!results[result.caller]) {
        results[result.caller] = {};
      }
      if (!results[result.caller][weekKey]) {
        results[result.caller][weekKey] = [];
      }
      
      results[result.caller][weekKey].push(result);
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Export results for each caller
  for (const [caller, weeks] of Object.entries(results)) {
    console.log(`\n📈 Processing ${caller}...`);
    
    const allResults = [];
    let totalCalls = 0;
    let totalProfitable = 0;
    let totalStopLossHit = 0;
    let totalPnl = 0;
    let totalEntryRating = 0;
    
    for (const [week, calls] of Object.entries(weeks)) {
      console.log(`  Week: ${week} - ${calls.length} calls`);
      
      for (const call of calls) {
        allResults.push({
          ...call,
          week: week
        });
        
        totalCalls++;
        if (call.finalPnl > 0) totalProfitable++;
        if (call.stopLossHit) totalStopLossHit++;
        totalPnl += call.finalPnl;
        totalEntryRating += call.entryRating;
      }
    }
    
    // Calculate summary stats
    const avgPnl = totalCalls > 0 ? totalPnl / totalCalls : 0;
    const successRate = totalCalls > 0 ? (totalProfitable / totalCalls) * 100 : 0;
    const stopLossRate = totalCalls > 0 ? (totalStopLossHit / totalCalls) * 100 : 0;
    const avgEntryRating = totalCalls > 0 ? totalEntryRating / totalCalls : 0;
    
    // Export to CSV
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
    
    // Export summary
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

// Run the analysis
analyzeByCaller().catch(console.error);
