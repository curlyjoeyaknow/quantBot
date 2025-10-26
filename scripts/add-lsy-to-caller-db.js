const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { Database } = require('sqlite3');
const { promisify } = require('util');

// Configuration
const CALLER_DB_PATH = process.env.CALLER_DB_PATH || './caller_alerts.db';
const LSY_CSV_PATH = path.join(__dirname, '../data/exports/csv/lsy_calls.csv');

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
 * Add Lsy calls to database
 */
async function addLsyCallsToDatabase(db, lsyCalls) {
  const run = promisify(db.run.bind(db));
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO caller_alerts 
    (caller_name, token_address, token_symbol, chain, alert_timestamp, alert_message, price_at_alert, volume_at_alert)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let addedCount = 0;
  for (const call of lsyCalls) {
    try {
      await new Promise((resolve, reject) => {
        stmt.run([
          call.sender,
          call.tokenAddress.toLowerCase(),
          call.tokenSymbol,
          call.chain,
          call.timestamp,
          call.message,
          null, // price_at_alert - will be fetched later if needed
          null  // volume_at_alert - will be fetched later if needed
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
        console.warn(`⚠️ Failed to add Lsy call for ${call.tokenAddress}: ${error.message}`);
      }
    }
  }

  stmt.finalize();
  console.log(`✅ Added ${addedCount}/${lsyCalls.length} Lsy calls`);
  return addedCount;
}

/**
 * Main function to add Lsy calls to caller database
 */
async function addLsyCallsToCallerDatabase() {
  console.log('🚀 Adding Lsy calls to Caller Database...');
  
  let db;
  try {
    // Initialize caller database
    db = await initCallerDatabase();
    
    // Read Lsy calls CSV
    console.log(`📄 Reading Lsy calls from: ${LSY_CSV_PATH}`);
    const csvContent = fs.readFileSync(LSY_CSV_PATH, 'utf8');
    
    const lsyCalls = await new Promise((resolve, reject) => {
      parse(csvContent, {
        columns: true,
        skip_empty_lines: true
      }, (err, records) => {
        if (err) reject(err);
        resolve(records);
      });
    });

    console.log(`📊 Found ${lsyCalls.length} Lsy calls`);

    // Add to database
    const addedCount = await addLsyCallsToDatabase(db, lsyCalls);

    // Get updated statistics
    const all = promisify(db.all.bind(db));
    const stats = await all(`
      SELECT 
        COUNT(*) as total_alerts,
        COUNT(DISTINCT caller_name) as total_callers,
        COUNT(DISTINCT token_address) as total_tokens
      FROM caller_alerts
    `);

    const lsyStats = await all(`
      SELECT 
        COUNT(*) as lsy_alerts,
        COUNT(DISTINCT token_address) as lsy_tokens
      FROM caller_alerts
      WHERE caller_name = 'Lsy♡'
    `);

    console.log('\n🎉 === LSY CALLS ADDED TO DATABASE ===');
    console.log(`📊 Lsy calls added: ${addedCount}/${lsyCalls.length}`);
    console.log(`📊 Total Lsy alerts in DB: ${lsyStats[0].lsy_alerts}`);
    console.log(`📊 Total Lsy tokens: ${lsyStats[0].lsy_tokens}`);
    console.log(`📊 Total alerts in DB: ${stats[0].total_alerts}`);
    console.log(`📊 Total callers in DB: ${stats[0].total_callers}`);
    console.log(`📊 Total tokens in DB: ${stats[0].total_tokens}`);

  } catch (error) {
    console.error('❌ Failed to add Lsy calls:', error);
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

// Run if this script is executed directly
if (require.main === module) {
  addLsyCallsToCallerDatabase()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ Failed:', error);
      process.exit(1);
    });
}

module.exports = { addLsyCallsToCallerDatabase };
