const fs = require('fs');
const path = require('path');
const { Database } = require('sqlite3');
const { promisify } = require('util');

// Configuration
const CALLER_DB_PATH = process.env.CALLER_DB_PATH || './caller_alerts.db';
const LSY_CSV_PATH = path.join(__dirname, '../data/exports/csv/lsy_calls.csv');
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
const BIRDEYE_API_BASE = 'https://public-api.birdeye.so';

/**
 * Initialize caller database
 */
function initCallerDatabase() {
  return new Promise((resolve, reject) => {
    const db = new Database(CALLER_DB_PATH);
    const run = promisify(db.run.bind(db));

    run(`
      CREATE TABLE IF NOT EXISTS caller_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        caller_name TEXT NOT NULL,
        token_address TEXT NOT NULL,
        token_symbol TEXT,
        chain TEXT NOT NULL DEFAULT 'solana',
        alert_timestamp DATETIME NOT NULL,
        alert_message TEXT,
        price_at_alert REAL,
        volume_at_alert REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(caller_name, token_address, alert_timestamp)
      )
    `).then(() => {
      console.log('✅ Database initialized');
      resolve(db);
    }).catch(reject);
  });
}

/**
 * Get Lsy calls from database
 */
async function getLsyCalls() {
  const db = await initCallerDatabase();
  const all = promisify(db.all.bind(db));
  
  try {
    const calls = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          caller_name,
          token_address,
          token_symbol,
          chain,
          alert_timestamp,
          price_at_alert
        FROM caller_alerts
        WHERE caller_name LIKE '%Lsy%'
        ORDER BY alert_timestamp ASC
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    return calls;
  } catch (error) {
    console.error('Error getting Lsy calls:', error);
    await new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    return [];
  }
}

/**
 * Get current price for a token
 */
async function getCurrentPrice(address, chain) {
  try {
    const axios = require('axios');
    const chainHeader = chain === 'solana' ? 'solana' : chain;
    
    const response = await axios.get(`${BIRDEYE_API_BASE}/defi/token_overview`, {
      headers: {
        'X-API-KEY': BIRDEYE_API_KEY,
        'accept': 'application/json',
        'x-chain': chainHeader
      },
      params: { address }
    });
    
    if (response.data.success && response.data.data) {
      return response.data.data.price || 0;
    }
    return 0;
  } catch (error) {
    console.error(`Error fetching price for ${address}:`, error.message);
    return 0;
  }
}

/**
 * Simulate trade with default strategy
 */
function simulateTrade(entryPrice, currentPrice, alertPrice) {
  if (!entryPrice || entryPrice === 0) return null;
  
  // Default strategy: 50%@2x, 30%@5x, 20%@10x
  const targets = [
    { percent: 0.5, target: 2 },
    { percent: 0.3, target: 5 },
    { percent: 0.2, target: 10 }
  ];
  
  let remaining = 1.0;
  let totalPnl = 0;
  let events = [];
  
  for (const { percent, target } of targets) {
    const targetPrice = entryPrice * target;
    
    if (currentPrice >= targetPrice) {
      // Hit take profit
      const pnl = (targetPrice - entryPrice) / entryPrice * percent;
      totalPnl += pnl;
      remaining -= percent;
      events.push({
        type: 'take_profit',
        target,
        percent,
        price: targetPrice,
        pnl
      });
    }
  }
  
  // If we still have remaining position and price is lower
  if (remaining > 0 && currentPrice < entryPrice) {
    const lossPercent = Math.min((entryPrice - currentPrice) / entryPrice, 0.5); // Max 50% loss
    totalPnl -= lossPercent * remaining;
    events.push({
      type: 'stop_loss',
      price: currentPrice,
      loss: lossPercent * remaining
    });
  }
  
  return {
    entryPrice,
    currentPrice,
    finalPnl: totalPnl,
    events,
    pnlPercent: totalPnl * 100
  };
}

/**
 * Main analysis function
 */
async function analyzeLsyCalls() {
  console.log('🚀 Analyzing Lsy calls...\n');
  
  const calls = await getLsyCalls();
  console.log(`📊 Found ${calls.length} Lsy calls\n`);
  
  if (calls.length === 0) {
    console.log('No Lsy calls found in database.');
    return;
  }
  
  const axios = require('axios');
  const results = [];
  
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    process.stdout.write(`\r📈 Processing ${i + 1}/${calls.length}: ${call.token_symbol || 'Unknown'}...`);
    
    try {
      const currentPrice = await getCurrentPrice(call.token_address, call.chain);
      const entryPrice = call.price_at_alert || 0;
      
      if (entryPrice > 0) {
        const simulation = simulateTrade(entryPrice, currentPrice, entryPrice);
        
        if (simulation) {
          results.push({
            number: i + 1,
            token: call.token_symbol || 'Unknown',
            address: call.token_address,
            chain: call.chain,
            alertDate: new Date(call.alert_timestamp).toLocaleDateString(),
            entryPrice: entryPrice.toFixed(8),
            currentPrice: currentPrice.toFixed(8),
            pnl: (simulation.pnlPercent).toFixed(2) + '%',
            finalMultiplier: currentPrice > 0 && entryPrice > 0 ? (currentPrice / entryPrice).toFixed(2) + 'x' : 'N/A',
            takeProfits: simulation.events.filter(e => e.type === 'take_profit').map(e => `${e.percent * 100}%@${e.target}x`).join(', ') || 'None',
            stopLoss: simulation.events.find(e => e.type === 'stop_loss') ? 'Yes' : 'No'
          });
        }
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.error(`\nError processing ${call.token_address}:`, error.message);
    }
  }
  
  console.log('\n\n📊 === LSY CALLS ANALYSIS RESULTS ===\n');
  
  // Display as data table
  console.log('┌─────┬────────────┬──────────────────────────────┬──────────┬─────────────┬────────────┬────────┬────────┬──────────────┐');
  console.log('│  #  │   Token    │         Address               │   Chain  │  Alert Date │ Entry Price│Current │  PNL   │  Multiplier  │');
  console.log('├─────┼────────────┼──────────────────────────────┼──────────┼─────────────┼────────────┼────────┼────────┼──────────────┤');
  
  results.forEach(result => {
    const num = result.number.toString().padEnd(3);
    const token = result.token.substring(0, 10).padEnd(10);
    const addr = result.address.substring(0, 28).padEnd(28);
    const chain = result.chain.substring(0, 8).padEnd(8);
    const date = result.alertDate.padEnd(11);
    const entry = result.entryPrice.padEnd(10);
    const current = result.currentPrice.padEnd(6);
    const pnl = result.pnl.padEnd(6);
    const mult = result.finalMultiplier.padEnd(12);
    
    console.log(`│ ${num} │ ${token} │ ${addr} │ ${chain} │ ${date} │ ${entry} │ ${current} │ ${pnl} │ ${mult} │`);
  });
  
  console.log('└─────┴────────────┴──────────────────────────────┴──────────┴─────────────┴────────────┴────────┴────────┴──────────────┘');
  
  // Summary statistics
  console.log('\n📊 Summary Statistics:');
  console.log(`   Total Calls: ${results.length}`);
  console.log(`   Winning Trades: ${results.filter(r => parseFloat(r.pnl) > 0).length}`);
  console.log(`   Losing Trades: ${results.filter(r => parseFloat(r.pnl) < 0).length}`);
  console.log(`   Average PNL: ${(results.reduce((sum, r) => sum + parseFloat(r.pnl), 0) / results.length).toFixed(2)}%`);
  console.log(`   Best Trade: ${Math.max(...results.map(r => parseFloat(r.pnl))).toFixed(2)}%`);
  console.log(`   Worst Trade: ${Math.min(...results.map(r => parseFloat(r.pnl))).toFixed(2)}%`);
  
  // Save to CSV
  const csvPath = path.join(__dirname, '../data/exports/csv/lsy_analysis.csv');
  const csvContent = [
    'Number,Token,Address,Chain,Alert Date,Entry Price,Current Price,PNL %,Multiplier,Take Profits,Stop Loss',
    ...results.map(r => [
      r.number,
      r.token,
      r.address,
      r.chain,
      r.alertDate,
      r.entryPrice,
      r.currentPrice,
      r.pnl,
      r.finalMultiplier,
      r.takeProfits,
      r.stopLoss
    ].join(','))
  ].join('\n');
  
  fs.writeFileSync(csvPath, csvContent);
  console.log(`\n💾 Results saved to: ${csvPath}`);
}

analyzeLsyCalls().catch(console.error);
