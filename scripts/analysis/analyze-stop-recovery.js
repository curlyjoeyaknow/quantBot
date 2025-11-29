const fs = require('fs');
const results = JSON.parse(fs.readFileSync('data/exports/brook_backtest_results.json', 'utf8'));
const successful = results.filter(r => r.success && r.pnl <= 1.0); // Losers only

console.log(`Analyzing ${successful.length} losing Brook calls...\n`);

for (const trade of successful) {
  // Find the cached candle file
  const cacheDir = 'cache';
  const files = fs.readdirSync(cacheDir);
  const cacheFile = files.find(f => f.includes(trade.address.substring(0, 30)));
  
  if (!cacheFile) {
    console.log(`❌ No cache for ${trade.address.substring(0, 30)}`);
    continue;
  }
  
  const candleData = fs.readFileSync(`cache/${cacheFile}`, 'utf8');
  const candles = candleData.split('\n').slice(1)
    .filter(l => l.trim())
    .map(l => {
      const [t, o, h, low, c, v] = l.split(',');
      return { 
        timestamp: parseInt(t), 
        open: parseFloat(o), 
        high: parseFloat(h), 
        low: parseFloat(low), 
        close: parseFloat(c), 
        volume: parseFloat(v) 
      };
    });
  
  const entryPrice = parseFloat(trade.entryPrice);
  const finalPrice = parseFloat(trade.finalPrice);
  
  // Find lowest before stop and highest after
  const stopLossPrice = entryPrice * 0.7; // -30% stop
  
  let lowestBeforeStop = entryPrice;
  let stopTimestamp = 0;
  let highestAfterStop = 0;
  let foundStop = false;
  
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    
    if (!foundStop && candle.low <= stopLossPrice) {
      foundStop = true;
      stopTimestamp = candle.timestamp;
    }
    
    if (!foundStop) {
      if (candle.low < lowestBeforeStop) {
        lowestBeforeStop = candle.low;
      }
    } else {
      if (candle.high > highestAfterStop) {
        highestAfterStop = candle.high;
      }
    }
  }
  
  const dropBeforeStop = ((lowestBeforeStop / entryPrice - 1) * 100).toFixed(1);
  const recoveryAfterStop = highestAfterStop > 0 ? ((highestAfterStop / stopLossPrice - 1) * 100).toFixed(1) : 'N/A';
  
  console.log(`\n${trade.address.substring(0, 30)}:`);
  console.log(`  Entry: $${entryPrice.toFixed(8)}`);
  console.log(`  Lowest before stop: $${lowestBeforeStop.toFixed(8)} (${dropBeforeStop}%)`);
  console.log(`  Stop at: $${stopLossPrice.toFixed(8)}`);
  console.log(`  Highest after stop: $${highestAfterStop.toFixed(8)} (${recoveryAfterStop}% from stop)`);
}

