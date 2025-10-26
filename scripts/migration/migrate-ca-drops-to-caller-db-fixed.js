const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { Database } = require('sqlite3');
const { promisify } = require('util');

// Configuration
const CALLER_DB_PATH = process.env.CALLER_DB_PATH || './caller_alerts.db';
const INPUT_CSV_PATH = path.join(__dirname, '../../data/exports/csv/brook_last_week_calls.csv');

// Bot names that should be filtered out (they respond to calls, don't make them)
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

// Initialize caller database
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
 * Check if a sender is a bot (responds to calls rather than making them)
 */
function isBot(sender) {
  if (!sender) return true;
  
  const senderLower = sender.toLowerCase().trim();
  
  // Check against known bot names
  for (const botName of BOT_NAMES) {
    if (senderLower.includes(botName.toLowerCase())) {
      return true;
    }
  }
  
  // Additional bot detection patterns
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
 * Parse timestamp string into a Date object
 */
function parseTimestamp(timestampStr) {
  try {
    const cleanTimestamp = timestampStr.replace(/"/g, '');
    const parts = cleanTimestamp.match(/(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2}) UTC([+-]\d{2}):(\d{2})/);
    if (parts) {
      const [, day, month, year, hour, minute, second, tzSign, tzMinute] = parts;
      const isoString = `${year}-${month}-${day}T${hour}:${minute}:${second}${tzSign}:${tzMinute}`;
      return new Date(isoString);
    }
    return new Date('Invalid Date');
  } catch (e) {
    console.warn(`Could not parse timestamp: ${timestampStr}`);
    return new Date('Invalid Date');
  }
}

/**
 * Clean and validate CA drop data - only include actual human callers
 */
function cleanCADropData(record) {
  const sender = record['Sender'] ? record['Sender'].trim() : '';
  const address = record['Address'] ? record['Address'].trim() : '';
  const timestampStr = record['Timestamp'] || '';
  
  // Skip if sender is a bot
  if (isBot(sender)) {
    return null;
  }
  
  // Skip if no valid address
  if (!address || 
      address === 'N/A' ||
      address.length < 10) {
    return null;
  }
  
  // Parse timestamp
  const alertTime = parseTimestamp(timestampStr);
  if (isNaN(alertTime.getTime())) {
    return null;
  }
  
  return {
    sender,
    tokenAddress: address,
    tokenSymbol: 'UNKNOWN', // Will be updated later if available
    chain: 'solana', // Default to solana
    timestamp: alertTime,
    message: record['Message Text'] || '',
    priceAtAlert: null, // Will be fetched later if needed
    volumeAtAlert: null
  };
}

/**
 * Add CA drops to database
 */
async function addCADropsToDatabase(db, caDrops) {
  const run = promisify(db.run.bind(db));
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO caller_alerts 
    (caller_name, token_address, token_symbol, chain, alert_timestamp, alert_message, price_at_alert, volume_at_alert)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let addedCount = 0;
  for (const drop of caDrops) {
    try {
      await new Promise((resolve, reject) => {
        stmt.run([
          drop.sender,
          drop.tokenAddress.toLowerCase(),
          drop.tokenSymbol,
          drop.chain,
          drop.timestamp.toISOString(),
          drop.message,
          drop.priceAtAlert,
          drop.volumeAtAlert
        ], function(err) {
          if (err) reject(err);
          else {
            if (this.changes > 0) addedCount++;
            resolve(this);
          }
        });
      });
    } catch (error) {
      // Skip duplicates silently
      if (!error.message.includes('UNIQUE constraint failed')) {
        console.warn(`⚠️ Failed to add CA drop for ${drop.tokenAddress}: ${error.message}`);
      }
    }
  }

  stmt.finalize();
  console.log(`✅ Added ${addedCount}/${caDrops.length} CA drops`);
  return addedCount;
}

/**
 * Get database statistics
 */
async function getDatabaseStats(db) {
  const all = promisify(db.all.bind(db));
  
  const rows = await all(`
    SELECT 
      COUNT(*) as total_alerts,
      COUNT(DISTINCT caller_name) as total_callers,
      COUNT(DISTINCT token_address) as total_tokens,
      MIN(alert_timestamp) as earliest_alert,
      MAX(alert_timestamp) as latest_alert
    FROM caller_alerts
  `);

  const row = rows[0];
  return {
    totalAlerts: row.total_alerts,
    totalCallers: row.total_callers,
    totalTokens: row.total_tokens,
    dateRange: {
      start: new Date(row.earliest_alert),
      end: new Date(row.latest_alert)
    }
  };
}

/**
 * Get top callers
 */
async function getTopCallers(db, limit = 10) {
  const all = promisify(db.all.bind(db));
  
  const rows = await all(`
    SELECT 
      caller_name,
      COUNT(*) as alert_count,
      COUNT(DISTINCT token_address) as unique_tokens
    FROM caller_alerts 
    GROUP BY caller_name
    ORDER BY alert_count DESC
    LIMIT ?
  `, [limit]);

  return rows.map(row => ({
    callerName: row.caller_name,
    alertCount: row.alert_count,
    uniqueTokens: row.unique_tokens
  }));
}

/**
 * Main migration function
 */
async function migrateCADropsToCallerDatabase() {
  console.log('🚀 Starting CA drops to Caller Database migration (filtering bots)...');
  
  let db;
  try {
    // Initialize caller database
    db = await initCallerDatabase();
    
    // Read CSV file
    console.log(`📄 Reading CA drops from: ${INPUT_CSV_PATH}`);
    const csvContent = fs.readFileSync(INPUT_CSV_PATH, 'utf8');
    
    const records = await new Promise((resolve, reject) => {
      parse(csvContent, {
        columns: true,
        skip_empty_lines: true
      }, (err, records) => {
        if (err) reject(err);
        resolve(records);
      });
    });

    console.log(`📊 Found ${records.length} total records`);

    // Clean and filter records (this will filter out bots)
    const cleanedRecords = records
      .map(cleanCADropData)
      .filter(record => record !== null);

    console.log(`✅ Cleaned ${cleanedRecords.length} valid CA drops (bots filtered out)`);

    // Add to database
    const addedCount = await addCADropsToDatabase(db, cleanedRecords);

    // Get updated statistics
    const stats = await getDatabaseStats(db);
    const topCallers = await getTopCallers(db, 20);

    console.log('\n🎉 === MIGRATION COMPLETE ===');
    console.log(`📊 Database Stats:`);
    console.log(`   - Total alerts: ${stats.totalAlerts}`);
    console.log(`   - Total callers: ${stats.totalCallers}`);
    console.log(`   - Total tokens: ${stats.totalTokens}`);
    console.log(`   - Date range: ${stats.dateRange.start.toISOString().split('T')[0]} to ${stats.dateRange.end.toISOString().split('T')[0]}`);
    
    console.log('\n🏆 Top 20 Callers:');
    topCallers.forEach((caller, index) => {
      console.log(`   ${index + 1}. ${caller.callerName.padEnd(30)} ${caller.alertCount.toString().padStart(3)} alerts, ${caller.uniqueTokens.toString().padStart(3)} tokens`);
    });

  } catch (error) {
    console.error('❌ Migration failed:', error);
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

// Handle command line arguments
if (process.argv.includes('--stats')) {
  // Just show stats
  async function showStats() {
    let db;
    try {
      db = await initCallerDatabase();
      const stats = await getDatabaseStats(db);
      const topCallers = await getTopCallers(db, 20);
      
      console.log('\n📊 === CALLER DATABASE STATISTICS ===');
      console.log(`🗄️ Database Stats:`);
      console.log(`   - Total alerts: ${stats.totalAlerts}`);
      console.log(`   - Total callers: ${stats.totalCallers}`);
      console.log(`   - Total tokens: ${stats.totalTokens}`);
      console.log(`   - Date range: ${stats.dateRange.start.toISOString().split('T')[0]} to ${stats.dateRange.end.toISOString().split('T')[0]}`);
      
      console.log('\n🏆 Top 20 Callers:');
      topCallers.forEach((caller, index) => {
        console.log(`   ${index + 1}. ${caller.callerName.padEnd(30)} ${caller.alertCount.toString().padStart(3)} alerts, ${caller.uniqueTokens.toString().padStart(3)} tokens`);
      });
    } catch (error) {
      console.error('❌ Failed to get stats:', error);
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
  
  showStats().then(() => process.exit(0)).catch(() => process.exit(1));
} else {
  // Run migration
  migrateCADropsToCallerDatabase()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    });
}
