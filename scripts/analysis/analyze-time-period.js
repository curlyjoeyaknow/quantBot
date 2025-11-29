const { Database } = require('sqlite3');
const { promisify } = require('util');

// Configuration
const CALLER_DB_PATH = process.env.CALLER_DB_PATH || './caller_alerts.db';

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
 * Get detailed time period analysis
 */
async function getTimePeriodAnalysis(db) {
  const all = promisify(db.all.bind(db));
  
  // Get calls by date
  const callsByDate = await all(`
    SELECT 
      DATE(alert_timestamp) as call_date,
      COUNT(*) as call_count,
      COUNT(DISTINCT caller_name) as unique_callers,
      COUNT(DISTINCT token_address) as unique_tokens
    FROM caller_alerts
    GROUP BY DATE(alert_timestamp)
    ORDER BY call_date ASC
  `);
  
  // Get calls by caller and date range
  const callsByCaller = await all(`
    SELECT 
      caller_name,
      COUNT(*) as total_calls,
      MIN(DATE(alert_timestamp)) as first_call,
      MAX(DATE(alert_timestamp)) as last_call,
      COUNT(DISTINCT token_address) as unique_tokens
    FROM caller_alerts
    GROUP BY caller_name
    ORDER BY total_calls DESC
  `);
  
  return { callsByDate, callsByCaller };
}

/**
 * Main analysis function
 */
async function analyzeTimePeriod() {
  console.log('📅 Analyzing call time periods...');
  
  let db;
  try {
    db = await initCallerDatabase();
    const analysis = await getTimePeriodAnalysis(db);
    
    console.log('\n📊 === TIME PERIOD ANALYSIS ===');
    
    console.log('\n📅 Calls by Date:');
    analysis.callsByDate.forEach(day => {
      console.log(`   ${day.call_date}: ${day.call_count.toString().padStart(2)} calls, ${day.unique_callers} callers, ${day.unique_tokens} tokens`);
    });
    
    console.log('\n👥 Top Callers with Date Ranges:');
    analysis.callsByCaller.slice(0, 10).forEach((caller, index) => {
      const daysActive = Math.ceil((new Date(caller.last_call) - new Date(caller.first_call)) / (1000 * 60 * 60 * 24)) + 1;
      console.log(`   ${index + 1}. ${caller.caller_name.padEnd(30)} ${caller.total_calls.toString().padStart(2)} calls (${caller.first_call} to ${caller.last_call}, ${daysActive} days active)`);
    });
    
    // Calculate summary stats
    const totalDays = analysis.callsByDate.length;
    const totalCalls = analysis.callsByDate.reduce((sum, day) => sum + day.call_count, 0);
    const avgCallsPerDay = (totalCalls / totalDays).toFixed(1);
    
    console.log('\n📈 Summary:');
    console.log(`   - Total period: ${totalDays} days`);
    console.log(`   - Total calls: ${totalCalls}`);
    console.log(`   - Average calls per day: ${avgCallsPerDay}`);
    console.log(`   - Most active day: ${analysis.callsByDate.reduce((max, day) => day.call_count > max.call_count ? day : max).call_date} (${Math.max(...analysis.callsByDate.map(d => d.call_count))} calls)`);
    
  } catch (error) {
    console.error('❌ Analysis failed:', error);
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

// Run analysis
analyzeTimePeriod()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ Failed:', error);
    process.exit(1);
  });
