const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const axios = require('axios');

const LSY_CSV = path.join(__dirname, '../data/exports/csv/lsy_calls.csv');
const OUTPUT_CSV = path.join(__dirname, '../data/exports/csv/lsy_analysis.csv');
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
const BIRDEYE_BASE = 'https://public-api.birdeye.so';

const STRATEGY = [
  { percent: 0.5, target: 2 },
  { percent: 0.3, target: 5 },
  { percent: 0.2, target: 10 },
];

function simulateStrategy(candles, entryPrice) {
  if (!candles || candles.length === 0) return null;
  
  let remaining = 1.0;
  let totalPnl = 0;
  const events = [];
  
  for (const { percent, target } of STRATEGY) {
    if (remaining <= 0) break;
    
    for (const candle of candles) {
      if (candle.high >= entryPrice * target) {
        const pnl = (entryPrice * target - entryPrice) / entryPrice * percent;
        totalPnl += pnl;
        remaining -= percent;
        events.push({ type: 'take_profit', target, percent });
        break;
      }
      
      if (candle.low <= entryPrice * 0.5) {
        const pnl = (candle.low - entryPrice) / entryPrice * remaining;
        totalPnl += pnl;
        remaining = 0;
        events.push({ type: 'stop_loss' });
        break;
      }
    }
  }
  
  if (remaining > 0) {
    const finalPrice = candles[candles.length - 1].close;
    totalPnl += (finalPrice - entryPrice) / entryPrice * remaining;
  }
  
  return { finalPnl: totalPnl, events, finalPrice: candles[candles.length - 1].close };
}

async function getTokenInfo(address, chain) {
  try {
    const chainHeader = chain === 'solana' ? 'solana' : chain;
    const response = await axios.get(`${BIRDEYE_BASE}/defi/token_overview`, {
      params: { address },
      headers: { 
        'X-API-KEY': BIRDEYE_API_KEY,
        'x-chain': chainHeader
      }
    });
    return response.data?.data || {};
  } catch (error) {
    return {};
  }
}

async function fetchOHLCV(address, startTime, endTime, chain) {
  try {
    const start = Math.floor(new Date(startTime).getTime() / 1000);
    const end = Math.floor(new Date(endTime).getTime() / 1000);
    
    const url = `${BIRDEYE_BASE}/defi/history_price?address=${address}&address_type=token&type=1m&time_from=${start}&time_to=${end}`;
    
    const response = await axios.get(url, {
      headers: { 'X-API-KEY': BIRDEYE_API_KEY }
    });
    
    return response.data?.items || [];
  } catch (error) {
    return [];
  }
}

async function main() {
  console.log('Reading Lsy calls...\n');
  
  const csv = fs.readFileSync(LSY_CSV, 'utf8');
  const records = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });
  
  console.log(`Found ${records.length} calls\n`);
  
  const results = [];
  
  for (let i = 0; i < records.length; i++) {
    const call = records[i];
    
    // Skip fake addresses
    if (call.tokenAddress.includes('4444')) continue;
    
    process.stdout.write(`\rProcessing ${i + 1}/${records.length}: ${call.tokenAddress.substring(0, 20)}...`);
    
    try {
      // Get token metadata
      const tokenInfo = await getTokenInfo(call.tokenAddress, call.chain);
      const tokenSymbol = tokenInfo.symbol || tokenInfo.name || call.tokenAddress.substring(0, 10);
      
      // Use ACTUAL alert dates from the call
      const alertDate = new Date(call.timestamp);
      const endDate = new Date(alertDate.getTime() + 7 * 24 * 60 * 60 * 1000);
      
      const candles = await fetchOHLCV(call.tokenAddress, alertDate, endDate, call.chain);
      
      if (candles.length > 0) {
        const entryPrice = candles[0].close;
        const result = simulateStrategy(candles, entryPrice);
        
        if (result) {
          results.push({
            token: tokenSymbol,
            address: call.tokenAddress,
            chain: call.chain,
            date: new Date(call.timestamp).toLocaleDateString(),
            entryPrice: entryPrice.toFixed(8),
            finalPrice: result.finalPrice.toFixed(8),
            pnl: (result.finalPnl * 100).toFixed(2) + '%',
            multiplier: entryPrice > 0 ? (result.finalPrice / entryPrice).toFixed(2) + 'x' : 'N/A',
            takeProfits: result.events.filter(e => e.type === 'take_profit').length
          });
        }
      }
      
      await new Promise(r => setTimeout(r, 500));
    } catch (error) {
      // Skip errors
    }
  }
  
  console.log(`\n\nComplete! Found data for ${results.length} calls\n`);
  
  if (results.length > 0) {
    const csvOut = [
      'Token,Address,Chain,Alert Date,Entry Price,Final Price,PNL %,Multiplier,Take Profits',
      ...results.map(r => 
        `${r.token},${r.address},${r.chain},${r.date},${r.entryPrice},${r.finalPrice},${r.pnl},${r.multiplier},${r.takeProfits}`
      )
    ].join('\n');
    
    fs.writeFileSync(OUTPUT_CSV, csvOut);
    console.log(`✅ Saved to ${OUTPUT_CSV}`);
    
    // Show results
    results.forEach((r, i) => {
      console.log(`${i + 1}. ${r.token} | ${r.pnl} | ${r.multiplier}`);
    });
  } else {
    console.log('❌ No valid data found');
  }
}

main().catch(console.error);
