const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { parse } = require('csv-parse');
const { stringify } = require('csv-stringify');
const { Database } = require('sqlite3');
const { promisify } = require('util');

// Configuration
const MESSAGES_BASE_DIR = path.join(__dirname, '../data/raw/messages');
const OUTPUT_DIR = path.join(__dirname, '../data/exports/csv');
const CALLER_DB_PATH = process.env.CALLER_DB_PATH || './caller_alerts.db';

// Brook channel folders to process
const BROOK_FOLDERS = ['brook', 'brook2', 'brook3'];

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
            chain: chain,
            timestamp: timestamp.toISOString(),
            message: messageText.substring(0, 500), // Truncate long messages
            sourceFile: path.basename(filePath),
            channel: channelName
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
        chain TEXT NOT NULL DEFAULT 'solana',
        alert_timestamp DATETIME NOT NULL,
        alert_message TEXT,
        price_at_alert REAL,
        volume_at_alert REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(caller_name, token_address, alert_timestamp)
      )
    `).then(() => {
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
 * Add calls to database
 */
async function addCallsToDatabase(db, calls) {
  const run = promisify(db.run.bind(db));
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO caller_alerts 
    (caller_name, token_address, token_symbol, chain, alert_timestamp, alert_message, price_at_alert, volume_at_alert)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let addedCount = 0;
  for (const call of calls) {
    try {
      await new Promise((resolve, reject) => {
        stmt.run([
          call.sender,
          call.tokenAddress.toLowerCase(),
          call.tokenSymbol,
          call.chain,
          call.timestamp,
          call.message,
          null, // price_at_alert
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
      }
    }
  }

  stmt.finalize();
  return addedCount;
}

/**
 * Main extraction function
 */
async function extractAllBrookChannels() {
  console.log('🚀 Starting comprehensive Brook channels extraction...');
  
  let db;
  try {
    // Initialize caller database
    db = await initCallerDatabase();
    
    let allCalls = [];
    let totalFilesProcessed = 0;
    
    // Process each Brook folder
    for (const folderName of BROOK_FOLDERS) {
      const folderPath = path.join(MESSAGES_BASE_DIR, folderName);
      
      if (!fs.existsSync(folderPath)) {
        console.log(`⚠️ Folder ${folderName} not found, skipping...`);
        continue;
      }
      
      console.log(`\n📁 Processing ${folderName} folder...`);
      
      // Get all HTML files in the folder
      const files = fs.readdirSync(folderPath)
        .filter(file => file.endsWith('.html'))
        .map(file => path.join(folderPath, file));
      
      console.log(`📄 Found ${files.length} message files in ${folderName}`);
      
      // Process each file
      for (const file of files) {
        try {
          const calls = processMessageFile(file, folderName);
          allCalls.push(...calls);
          totalFilesProcessed++;
        } catch (error) {
          console.error(`❌ Error processing ${file}:`, error.message);
        }
      }
    }
    
    console.log(`\n📊 Total processing complete:`);
    console.log(`   - Files processed: ${totalFilesProcessed}`);
    console.log(`   - Total calls found: ${allCalls.length}`);
    
    // Remove duplicates based on token address and timestamp
    const uniqueCalls = allCalls.filter((call, index, self) => 
      index === self.findIndex(c => 
        c.tokenAddress === call.tokenAddress && 
        c.sender === call.sender &&
        Math.abs(new Date(c.timestamp).getTime() - new Date(call.timestamp).getTime()) < 60000 // Within 1 minute
      )
    );
    
    console.log(`   - Unique calls: ${uniqueCalls.length}`);
    
    // Sort by timestamp
    uniqueCalls.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    // Save to CSV
    const csvContent = await new Promise((resolve, reject) => {
      stringify(uniqueCalls, {
        header: true,
        columns: ['sender', 'tokenAddress', 'tokenSymbol', 'chain', 'timestamp', 'message', 'sourceFile', 'channel']
      }, (err, output) => {
        if (err) reject(err);
        else resolve(output);
      });
    });
    
    const outputFile = path.join(OUTPUT_DIR, 'all_brook_channels_calls.csv');
    fs.writeFileSync(outputFile, csvContent);
    console.log(`📋 All calls saved to: ${outputFile}`);
    
    // Add to database
    console.log('\n💾 Adding calls to database...');
    const addedCount = await addCallsToDatabase(db, uniqueCalls);
    
    // Get updated statistics
    const all = promisify(db.all.bind(db));
    const stats = await all(`
      SELECT 
        COUNT(*) as total_alerts,
        COUNT(DISTINCT caller_name) as total_callers,
        COUNT(DISTINCT token_address) as total_tokens
      FROM caller_alerts
    `);
    
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
    
    console.log('\n🎉 === COMPREHENSIVE BROOK CHANNELS EXTRACTION COMPLETE ===');
    console.log(`📊 Database Stats:`);
    console.log(`   - Total alerts: ${stats[0].total_alerts}`);
    console.log(`   - Total callers: ${stats[0].total_callers}`);
    console.log(`   - Total tokens: ${stats[0].total_tokens}`);
    console.log(`   - Calls added this run: ${addedCount}`);
    
    console.log('\n🏆 Top 20 Callers:');
    topCallers.forEach((caller, index) => {
      console.log(`   ${index + 1}. ${caller.caller_name.padEnd(30)} ${caller.alert_count.toString().padStart(3)} alerts, ${caller.token_count.toString().padStart(3)} tokens`);
    });
    
    return uniqueCalls;
    
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
  extractAllBrookChannels()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ Extraction failed:', error);
      process.exit(1);
    });
}

module.exports = { extractAllBrookChannels };
