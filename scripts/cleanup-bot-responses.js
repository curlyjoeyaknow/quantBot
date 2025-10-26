const { Database } = require('sqlite3');
const { promisify } = require('util');

// Configuration
const CALLER_DB_PATH = process.env.CALLER_DB_PATH || './caller_alerts.db';

// Bot names that should be removed (they respond to calls, don't make them)
const BOT_NAMES = [
  'Rick',
  'Phanes [Gold]',
  'Phanes',
  'RickBurpBot',
  'PhanesGoldBot',
  'RickSanchez',
  'RickBurp',
  'PhanesBot'
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
      console.log('✅ Caller database initialized successfully');
      resolve(db);
    }).catch(reject);
  });
}

/**
 * Remove bot responses from the database
 */
async function removeBotResponses(db) {
  const all = promisify(db.all.bind(db));
  const run = promisify(db.run.bind(db));
  
  console.log('🤖 Removing bot responses from caller database...');
  
  // Get current stats before cleanup
  const beforeStats = await all(`
    SELECT 
      COUNT(*) as total_alerts,
      COUNT(DISTINCT caller_name) as total_callers,
      COUNT(DISTINCT token_address) as total_tokens
    FROM caller_alerts
  `);
  
  console.log(`📊 Before cleanup: ${beforeStats[0].total_alerts} alerts, ${beforeStats[0].total_callers} callers`);
  
  // Remove bot responses
  let totalRemoved = 0;
  for (const botName of BOT_NAMES) {
    const result = await run(`DELETE FROM caller_alerts WHERE caller_name LIKE ?`, [`%${botName}%`]);
    if (result.changes > 0) {
      console.log(`  🗑️ Removed ${result.changes} alerts from ${botName}`);
      totalRemoved += result.changes;
    }
  }
  
  // Get stats after cleanup
  const afterStats = await all(`
    SELECT 
      COUNT(*) as total_alerts,
      COUNT(DISTINCT caller_name) as total_callers,
      COUNT(DISTINCT token_address) as total_tokens
    FROM caller_alerts
  `);
  
  console.log(`📊 After cleanup: ${afterStats[0].total_alerts} alerts, ${afterStats[0].total_callers} callers`);
  console.log(`🗑️ Total removed: ${totalRemoved} bot responses`);
  
  return { before: beforeStats[0], after: afterStats[0], removed: totalRemoved };
}

/**
 * Get updated caller statistics
 */
async function getCallerStats(db) {
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

  const dateRange = await all(`
    SELECT 
      MIN(alert_timestamp) as earliest,
      MAX(alert_timestamp) as latest
    FROM caller_alerts
  `);

  return { stats: stats[0], topCallers, dateRange: dateRange[0] };
}

/**
 * Main cleanup function
 */
async function cleanupBotResponses() {
  console.log('🚀 Starting bot response cleanup...');
  
  let db;
  try {
    // Initialize caller database
    db = await initCallerDatabase();
    
    // Remove bot responses
    const cleanupResults = await removeBotResponses(db);
    
    // Get updated statistics
    const stats = await getCallerStats(db);
    
    console.log('\n🎉 === BOT RESPONSE CLEANUP COMPLETE ===');
    console.log(`📊 Cleaned database stats:`);
    console.log(`   - Total alerts: ${stats.stats.total_alerts}`);
    console.log(`   - Total callers: ${stats.stats.total_callers}`);
    console.log(`   - Total tokens: ${stats.stats.total_tokens}`);
    console.log(`   - Date range: ${stats.dateRange.earliest?.split('T')[0]} to ${stats.dateRange.latest?.split('T')[0]}`);
    
    console.log('\n🏆 Top 10 Real Callers:');
    stats.topCallers.slice(0, 10).forEach((caller, index) => {
      console.log(`   ${index + 1}. ${caller.caller_name.padEnd(30)} ${caller.alert_count.toString().padStart(3)} alerts, ${caller.token_count.toString().padStart(3)} tokens`);
    });
    
    console.log(`\n🗑️ Removed ${cleanupResults.removed} bot responses`);
    console.log(`✅ Database now contains only actual human callers`);

  } catch (error) {
    console.error('❌ Cleanup failed:', error);
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
  cleanupBotResponses()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ Failed:', error);
      process.exit(1);
    });
}

module.exports = { cleanupBotResponses };
