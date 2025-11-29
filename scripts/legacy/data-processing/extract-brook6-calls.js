const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { parse } = require('csv-parse');
const { stringify } = require('csv-stringify');
const { Database } = require('sqlite3');
const { promisify } = require('util');
const axios = require('axios');

// Configuration
const MESSAGES_BASE_DIR = path.join(__dirname, '../data/raw/messages');
const OUTPUT_DIR = path.join(__dirname, '../data/exports/csv');
const CALLER_DB_PATH = process.env.CALLER_DB_PATH || './caller_alerts.db';
const BROOK6_FOLDER = 'brook6';
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || process.env.BIRDEYE_API_KEY_1 || 'dec8084b90724ffe949b68d0a18359d6';

// Bot names that should be filtered out
const BOT_NAMES = [
  'Rick',
  'Phanes [Gold]',
  'Phanes',
  'RickBurpBot',
  'PhanesGoldBot',
  'RickSanchez',
  'RickBurp',
  'PhanesBot',
  'RickBurpBot',
  'PhanesGoldBot'
];

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Check if a sender is a bot
 */
function isBot(sender) {
  if (!sender) return true;
  
  const senderLower = sender.toLowerCase().trim();
  
  for (const botName of BOT_NAMES) {
    if (senderLower.includes(botName.toLowerCase())) {
      return true;
    }
  }
  
  const botPatterns = [
    /bot$/i,
    /gold$/i,
    /burp/i,
    /phanes/i,
    /rick/i
  ];
  
  return botPatterns.some(pattern => pattern.test(senderLower));
}

/**
 * Parse timestamp from Telegram message
 */
function parseTelegramTimestamp(timestampStr) {
  try {
    // Handle Telegram format: "03.10.2025 12:52:12 UTC+10:00"
    if (timestampStr.includes('UTC')) {
      const match = timestampStr.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
      if (match) {
        const [, day, month, year, hour, minute, second] = match;
        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second));
        return date;
      }
    }
    
    return new Date('Invalid Date');
  } catch (error) {
    console.warn(`Could not parse timestamp: ${timestampStr}`);
    return new Date('Invalid Date');
  }
}

/**
 * Extract token address from message text
 */
function extractTokenAddress(text) {
  const patterns = [
    /0x[a-fA-F0-9]{40}/g,  // Ethereum/BSC addresses
    /[1-9A-HJ-NP-Za-km-z]{32,44}/g  // Solana addresses
  ];
  
  const addresses = [];
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      addresses.push(...matches);
    }
  }
  
  return addresses;
}

/**
 * Extract token symbol/name from message text
 */
function extractTokenInfo(text) {
  const symbolPatterns = [
    /🪙\s*Token:\s*([^(]+)/i,
    /Token:\s*([^(]+)/i,
    /🪙\s*([^(]+)/i,
    /^([A-Z0-9]+)\s*\[/i,
    /^([A-Z0-9]+)\s*\(/i
  ];
  
  for (const pattern of symbolPatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  
  return 'UNKNOWN';
}

/**
 * Determine chain from token address
 */
function determineChain(address) {
  if (address.startsWith('0x') && address.length === 42) {
    return 'bsc'; // Default to BSC for 0x addresses
  } else if (address.length >= 32 && address.length <= 44) {
    return 'solana';
  }
  return 'unknown';
}

/**
 * Fetch token metadata from Birdeye
 */
async function fetchTokenMetadata(tokenAddress, chain = 'solana') {
  if (!BIRDEYE_API_KEY) {
    return null;
  }
  
  try {
    const response = await axios.get(
      'https://public-api.birdeye.so/defi/v3/token/meta-data/single',
      {
        headers: {
          'X-API-KEY': BIRDEYE_API_KEY,
          'accept': 'application/json',
          'x-chain': chain,
        },
        params: {
          address: tokenAddress,
        },
        timeout: 5000,
      }
    );
    
    if (response.data?.success && response.data?.data) {
      const data = response.data.data;
      return {
        name: data.name || `Token ${tokenAddress.substring(0, 8)}`,
        symbol: data.symbol || tokenAddress.substring(0, 4).toUpperCase(),
        price: data.price,
        marketCap: data.marketCap,
      };
    }
  } catch (error) {
    // Silently fail
  }
  
  return null;
}

/**
 * Fetch historical price at a specific timestamp
 */
async function fetchHistoricalPrice(tokenAddress, timestamp, chain = 'solana') {
  if (!BIRDEYE_API_KEY) {
    return null;
  }
  
  const unixTimestamp = Math.floor(timestamp.getTime() / 1000);
  const timeWindow = 3600; // 1 hour window
  
  try {
    // Try history_price endpoint first
    const historyResponse = await axios.get('https://public-api.birdeye.so/defi/history_price', {
      headers: {
        'X-API-KEY': BIRDEYE_API_KEY,
        'accept': 'application/json',
        'x-chain': chain,
      },
      params: {
        address: tokenAddress,
        address_type: 'token',
        type: '1m',
        time_from: unixTimestamp - timeWindow,
        time_to: unixTimestamp + timeWindow,
        ui_amount_mode: 'raw',
      },
      timeout: 10000,
    });
    
    if (historyResponse.data?.success && historyResponse.data?.data?.items) {
      const items = historyResponse.data.data.items;
      if (items.length > 0) {
        // Find closest price point
        let closestItem = items[0];
        let minDiff = Math.abs(closestItem.unixTime - unixTimestamp);
        
        for (const item of items) {
          const diff = Math.abs(item.unixTime - unixTimestamp);
          if (diff < minDiff) {
            minDiff = diff;
            closestItem = item;
          }
        }
        
        return {
          price: closestItem.value || closestItem.price || 0,
          marketCap: closestItem.marketCap || 0,
        };
      }
    }
    
    // Fallback to OHLCV endpoint
    const ohlcvResponse = await axios.get('https://public-api.birdeye.so/defi/v3/ohlcv', {
      headers: {
        'X-API-KEY': BIRDEYE_API_KEY,
        'accept': 'application/json',
        'x-chain': chain,
      },
      params: {
        address: tokenAddress,
        type: '5m',
        currency: 'usd',
        ui_amount_mode: 'raw',
        time_from: unixTimestamp - timeWindow,
        time_to: unixTimestamp + timeWindow,
        mode: 'range',
        padding: true,
      },
      timeout: 10000,
    });
    
    if (ohlcvResponse.data?.success && ohlcvResponse.data?.data?.items) {
      const candles = ohlcvResponse.data.data.items;
      if (candles.length > 0) {
        let closestCandle = candles[0];
        let minDiff = Math.abs(closestCandle.unix_time - unixTimestamp);
        
        for (const candle of candles) {
          const diff = Math.abs(candle.unix_time - unixTimestamp);
          if (diff < minDiff) {
            minDiff = diff;
            closestCandle = candle;
          }
        }
        
        return {
          price: closestCandle.c || closestCandle.close || 0,
          marketCap: closestCandle.mc || 0,
        };
      }
    }
  } catch (error) {
    // Silently fail
  }
  
  return null;
}

/**
 * Process a single HTML message file
 */
function processMessageFile(filePath, channelName) {
  console.log(`📄 Processing ${path.basename(filePath)} from ${channelName}...`);
  
  const htmlContent = fs.readFileSync(filePath, 'utf8');
  const $ = cheerio.load(htmlContent);
  const calls = [];
  
  // Find all message elements
  $('.message').each((index, element) => {
    const $message = $(element);
    
    // Check if this message is from a real caller (not a bot)
    const $fromName = $message.find('.from_name');
    const senderName = $fromName.text().trim();
    
    if (!isBot(senderName)) {
      // Extract timestamp
      const $dateElement = $message.find('.date');
      const timestampStr = $dateElement.attr('title') || $dateElement.text() || '';
      
      // Extract message text
      const $textElement = $message.find('.text');
      const messageText = $textElement.text().trim();
      
      // Extract token addresses
      const tokenAddresses = extractTokenAddress(messageText);
      
      // Extract token info
      const tokenSymbol = extractTokenInfo(messageText);
      
      // Process each token address found
      tokenAddresses.forEach(address => {
        const chain = determineChain(address);
        const timestamp = parseTelegramTimestamp(timestampStr);
        
        if (!isNaN(timestamp.getTime())) {
          calls.push({
            sender: senderName,
            tokenAddress: address,
            tokenSymbol: tokenSymbol,
            tokenName: null, // Will be filled later with metadata
            chain: chain,
            timestamp: timestamp.toISOString(),
            message: messageText.substring(0, 500), // Truncate long messages
            sourceFile: path.basename(filePath),
            channel: channelName,
            priceAtAlert: null, // Will be filled later with metadata
            marketCapAtAlert: null // Will be filled later with metadata
          });
        }
      });
    }
  });
  
  console.log(`  ✅ Found ${calls.length} calls from ${channelName}`);
  return calls;
}

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
        token_name TEXT,
        chain TEXT NOT NULL DEFAULT 'solana',
        alert_timestamp DATETIME NOT NULL,
        alert_message TEXT,
        price_at_alert REAL,
        market_cap_at_alert REAL,
        volume_at_alert REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(caller_name, token_address, alert_timestamp)
      )
    `).then(() => {
      // Add new columns if they don't exist (for existing databases)
      return run(`ALTER TABLE caller_alerts ADD COLUMN token_name TEXT`).catch(() => {
        // Column already exists, ignore
      });
    }).then(() => {
      return run(`ALTER TABLE caller_alerts ADD COLUMN market_cap_at_alert REAL`).catch(() => {
        // Column already exists, ignore
      });
    }).then(() => {
      return run(`CREATE INDEX IF NOT EXISTS idx_caller_name ON caller_alerts(caller_name)`);
    }).then(() => {
      return run(`CREATE INDEX IF NOT EXISTS idx_token_address ON caller_alerts(token_address)`);
    }).then(() => {
      return run(`CREATE INDEX IF NOT EXISTS idx_alert_timestamp ON caller_alerts(alert_timestamp)`);
    }).then(() => {
      return run(`CREATE INDEX IF NOT EXISTS idx_caller_timestamp ON caller_alerts(caller_name, alert_timestamp)`);
    }).then(() => {
      console.log('✅ Caller database initialized successfully');
      resolve(db);
    }).catch(reject);
  });
}

/**
 * Check if a call already exists in the database
 */
async function callExists(db, call) {
  const all = promisify(db.all.bind(db));
  const results = await all(`
    SELECT COUNT(*) as count
    FROM caller_alerts
    WHERE caller_name = ? 
      AND token_address = ? 
      AND ABS((julianday(alert_timestamp) - julianday(?)) * 86400) < 60
  `, [call.sender, call.tokenAddress.toLowerCase(), call.timestamp]);
  
  return results[0].count > 0;
}

/**
 * Add calls to database (only new ones)
 */
async function addCallsToDatabase(db, calls) {
  const run = promisify(db.run.bind(db));
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO caller_alerts 
    (caller_name, token_address, token_symbol, token_name, chain, alert_timestamp, alert_message, price_at_alert, market_cap_at_alert, volume_at_alert)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let addedCount = 0;
  let skippedCount = 0;
  
  for (const call of calls) {
    try {
      const exists = await callExists(db, call);
      if (exists) {
        skippedCount++;
        continue;
      }
      
      await new Promise((resolve, reject) => {
        stmt.run([
          call.sender,
          call.tokenAddress.toLowerCase(),
          call.tokenSymbol || null,
          call.tokenName || null,
          call.chain,
          call.timestamp,
          call.message,
          call.priceAtAlert || null,
          call.marketCapAtAlert || null,
          null  // volume_at_alert
        ], function(err) {
          if (err) reject(err);
          else {
            if (this.changes > 0) addedCount++;
            resolve(this);
          }
        });
      });
    } catch (error) {
      if (!error.message.includes('UNIQUE constraint failed')) {
        console.warn(`⚠️ Failed to add call for ${call.tokenAddress}: ${error.message}`);
      } else {
        skippedCount++;
      }
    }
  }

  stmt.finalize();
  return { addedCount, skippedCount };
}

/**
 * Load existing calls from CSV to check for duplicates
 */
async function loadExistingCalls() {
  const csvPath = path.join(OUTPUT_DIR, 'all_brook_channels_calls.csv');
  
  if (!fs.existsSync(csvPath)) {
    return new Set();
  }
  
  const csv = fs.readFileSync(csvPath, 'utf8');
  const records = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });
  
  // Create a set of unique identifiers: sender + tokenAddress + timestamp (rounded to minute)
  const existingCalls = new Set();
  for (const record of records) {
    const timestamp = new Date(record.timestamp || record.Timestamp);
    const minuteKey = `${timestamp.getFullYear()}-${timestamp.getMonth()}-${timestamp.getDate()}-${timestamp.getHours()}-${timestamp.getMinutes()}`;
    const key = `${(record.sender || '').toLowerCase()}|${(record.tokenAddress || record.token_address || '').toLowerCase()}|${minuteKey}`;
    existingCalls.add(key);
  }
  
  return existingCalls;
}

/**
 * Check if call exists in existing CSV
 */
function isNewCall(call, existingCalls) {
  const timestamp = new Date(call.timestamp);
  const minuteKey = `${timestamp.getFullYear()}-${timestamp.getMonth()}-${timestamp.getDate()}-${timestamp.getHours()}-${timestamp.getMinutes()}`;
  const key = `${call.sender.toLowerCase()}|${call.tokenAddress.toLowerCase()}|${minuteKey}`;
  return !existingCalls.has(key);
}

/**
 * Enrich calls with metadata (name, symbol, price, market cap)
 */
async function enrichCallsWithMetadata(calls) {
  console.log(`\n📊 Fetching metadata for ${calls.length} calls...`);
  
  let enriched = 0;
  let failed = 0;
  
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    
    try {
      // Fetch token metadata
      const metadata = await fetchTokenMetadata(call.tokenAddress, call.chain);
      
      if (metadata) {
        call.tokenName = metadata.name;
        // Update symbol if we got a better one from API
        if (metadata.symbol && metadata.symbol !== 'UNKNOWN') {
          call.tokenSymbol = metadata.symbol;
        }
      }
      
      // Fetch historical price at alert time
      const alertTimestamp = new Date(call.timestamp);
      const priceData = await fetchHistoricalPrice(call.tokenAddress, alertTimestamp, call.chain);
      
      if (priceData) {
        call.priceAtAlert = priceData.price;
        call.marketCapAtAlert = priceData.marketCap;
      } else if (metadata) {
        // Fallback to current price if historical not available
        call.priceAtAlert = metadata.price || null;
        call.marketCapAtAlert = metadata.marketCap || null;
      }
      
      if (metadata || priceData) {
        enriched++;
      } else {
        failed++;
      }
      
      // Progress indicator
      if ((i + 1) % 10 === 0) {
        process.stdout.write(`\r   Processed ${i + 1}/${calls.length} calls...`);
      }
      
      // Rate limiting - small delay between requests
      if (i < calls.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      failed++;
      // Continue with next call
    }
  }
  
  console.log(`\r   ✅ Enriched ${enriched} calls, ${failed} failed to fetch metadata`);
  
  return calls;
}

/**
 * Main extraction function
 */
async function extractBrook6Calls() {
  console.log('🚀 Starting Brook6 calls extraction...');
  
  let db;
  try {
    // Initialize caller database
    db = await initCallerDatabase();
    
    // Load existing calls from CSV
    console.log('📋 Loading existing calls from CSV...');
    const existingCalls = await loadExistingCalls();
    console.log(`   Found ${existingCalls.size} existing calls in CSV`);
    
    const folderPath = path.join(MESSAGES_BASE_DIR, BROOK6_FOLDER);
    
    if (!fs.existsSync(folderPath)) {
      throw new Error(`Folder ${BROOK6_FOLDER} not found at ${folderPath}`);
    }
    
    console.log(`\n📁 Processing ${BROOK6_FOLDER} folder...`);
    
    // Get all HTML files in the folder
    const files = fs.readdirSync(folderPath)
      .filter(file => file.endsWith('.html'))
      .map(file => path.join(folderPath, file));
    
    console.log(`📄 Found ${files.length} message files in ${BROOK6_FOLDER}`);
    
    let allCalls = [];
    let totalFilesProcessed = 0;
    
    // Process each file
    for (const file of files) {
      try {
        const calls = processMessageFile(file, BROOK6_FOLDER);
        allCalls.push(...calls);
        totalFilesProcessed++;
      } catch (error) {
        console.error(`❌ Error processing ${file}:`, error.message);
      }
    }
    
    console.log(`\n📊 Processing complete:`);
    console.log(`   - Files processed: ${totalFilesProcessed}`);
    console.log(`   - Total calls found: ${allCalls.length}`);
    
    // Filter to only new calls
    const newCalls = allCalls.filter(call => isNewCall(call, existingCalls));
    console.log(`   - New calls: ${newCalls.length}`);
    console.log(`   - Duplicate calls: ${allCalls.length - newCalls.length}`);
    
    if (newCalls.length === 0) {
      console.log('\n✨ No new calls found in brook6!');
      return [];
    }
    
    // Remove duplicates based on token address and timestamp
    const uniqueCalls = newCalls.filter((call, index, self) => 
      index === self.findIndex(c => 
        c.tokenAddress === call.tokenAddress && 
        c.sender === call.sender &&
        Math.abs(new Date(c.timestamp).getTime() - new Date(call.timestamp).getTime()) < 60000 // Within 1 minute
      )
    );
    
    console.log(`   - Unique new calls: ${uniqueCalls.length}`);
    
    // Enrich calls with metadata
    const enrichedCalls = await enrichCallsWithMetadata(uniqueCalls);
    
    // Sort by timestamp
    enrichedCalls.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    // Load existing CSV and append new calls
    const csvPath = path.join(OUTPUT_DIR, 'all_brook_channels_calls.csv');
    let allExistingCalls = [];
    
    if (fs.existsSync(csvPath)) {
      const csv = fs.readFileSync(csvPath, 'utf8');
      allExistingCalls = await new Promise((resolve, reject) => {
        parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
          if (err) reject(err);
          else {
            // Ensure all records have the new metadata fields (for backward compatibility)
            const normalized = records.map(record => ({
              ...record,
              tokenName: record.tokenName || null,
              priceAtAlert: record.priceAtAlert || null,
              marketCapAtAlert: record.marketCapAtAlert || null
            }));
            resolve(normalized);
          }
        });
      });
    }
    
    // Combine existing and new calls
    const combinedCalls = [...allExistingCalls, ...enrichedCalls];
    
    // Save to CSV
    const csvContent = await new Promise((resolve, reject) => {
      stringify(combinedCalls, {
        header: true,
        columns: ['sender', 'tokenAddress', 'tokenSymbol', 'tokenName', 'chain', 'timestamp', 'message', 'sourceFile', 'channel', 'priceAtAlert', 'marketCapAtAlert']
      }, (err, output) => {
        if (err) reject(err);
        else resolve(output);
      });
    });
    
    fs.writeFileSync(csvPath, csvContent);
    console.log(`📋 Updated CSV saved to: ${csvPath}`);
    
    // Add to database
    console.log('\n💾 Adding new calls to database...');
    const { addedCount, skippedCount } = await addCallsToDatabase(db, enrichedCalls);
    
    // Get updated statistics
    const all = promisify(db.all.bind(db));
    const stats = await all(`
      SELECT 
        COUNT(*) as total_alerts,
        COUNT(DISTINCT caller_name) as total_callers,
        COUNT(DISTINCT token_address) as total_tokens
      FROM caller_alerts
    `);
    
    // Note: Channel info is stored in CSV, not database. 
    // We can check sourceFile in alert_message if needed, but it's not critical
    const brook6Stats = { 
      total_alerts: enrichedCalls.length, 
      total_callers: new Set(enrichedCalls.map(c => c.sender)).size, 
      total_tokens: new Set(enrichedCalls.map(c => c.tokenAddress)).size,
      with_metadata: enrichedCalls.filter(c => c.tokenName || c.priceAtAlert).length
    };
    
    const topCallers = await all(`
      SELECT 
        caller_name,
        COUNT(*) as alert_count,
        COUNT(DISTINCT token_address) as token_count
      FROM caller_alerts
      GROUP BY caller_name
      ORDER BY alert_count DESC
      LIMIT 20
    `);
    
    console.log('\n🎉 === BROOK6 CALLS EXTRACTION COMPLETE ===');
    console.log(`📊 Database Stats:`);
    console.log(`   - Total alerts: ${stats[0].total_alerts}`);
    console.log(`   - Total callers: ${stats[0].total_callers}`);
    console.log(`   - Total tokens: ${stats[0].total_tokens}`);
    console.log(`   - New calls added this run: ${addedCount}`);
    console.log(`   - Calls skipped (duplicates): ${skippedCount}`);
    
    if (brook6Stats.total_alerts > 0) {
      console.log(`\n📊 Brook6 Specific Stats (this extraction):`);
      console.log(`   - Brook6 alerts: ${brook6Stats.total_alerts}`);
      console.log(`   - Brook6 callers: ${brook6Stats.total_callers}`);
      console.log(`   - Brook6 tokens: ${brook6Stats.total_tokens}`);
      console.log(`   - Calls with metadata: ${brook6Stats.with_metadata}`);
    }
    
    console.log('\n🏆 Top 20 Callers:');
    topCallers.forEach((caller, index) => {
      console.log(`   ${index + 1}. ${caller.caller_name.padEnd(30)} ${caller.alert_count.toString().padStart(3)} alerts, ${caller.token_count.toString().padStart(3)} tokens`);
    });
    
    return enrichedCalls;
    
  } catch (error) {
    console.error('❌ Extraction failed:', error);
    throw error;
  } finally {
    if (db) {
      await new Promise((resolve, reject) => {
        db.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }
}

// Run extraction if this script is executed directly
if (require.main === module) {
  extractBrook6Calls()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ Extraction failed:', error);
      process.exit(1);
    });
}

module.exports = { extractBrook6Calls };

