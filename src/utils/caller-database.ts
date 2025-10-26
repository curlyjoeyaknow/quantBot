import { Database } from 'sqlite3';
import { promisify } from 'util';

// Configuration
const CALLER_DB_PATH = process.env.CALLER_DB_PATH || './caller_alerts.db';

/**
 * Initialize caller database connection
 */
function initCallerDatabase(): Promise<Database> {
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
 * Find calls for a specific token address
 */
async function findCallsForToken(tokenAddress: string): Promise<any[]> {
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
          alert_message,
          price_at_alert,
          volume_at_alert
        FROM caller_alerts
        WHERE LOWER(token_address) = LOWER(?)
        ORDER BY alert_timestamp DESC
      `, [tokenAddress], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    }) as any[];
    
    await new Promise<void>((resolve, reject) => {
      db.close((err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    return calls as any[];
  } catch (error) {
    console.error('Error finding calls for token:', error);
    await new Promise<void>((resolve, reject) => {
      db.close((err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
    return [];
  }
}

/**
 * Get recent calls (for /history command)
 */
async function getRecentCalls(limit: number = 20): Promise<any[]> {
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
          alert_message,
          price_at_alert,
          volume_at_alert
        FROM caller_alerts
        ORDER BY alert_timestamp DESC
        LIMIT ?
      `, [limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    }) as any[];
    
    await new Promise<void>((resolve, reject) => {
      db.close((err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    return calls as any[];
  } catch (error) {
    console.error('Error getting recent calls:', error);
    await new Promise<void>((resolve, reject) => {
      db.close((err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
    return [];
  }
}

/**
 * Get caller statistics
 */
async function getCallerStats(): Promise<{ stats: any; topCallers: any[] }> {
  const db = await initCallerDatabase();
  const all = promisify(db.all.bind(db));
  
  try {
    const stats = await all(`
      SELECT 
        COUNT(*) as total_alerts,
        COUNT(DISTINCT caller_name) as total_callers,
        COUNT(DISTINCT token_address) as total_tokens,
        MIN(alert_timestamp) as earliest_alert,
        MAX(alert_timestamp) as latest_alert
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
      LIMIT 10
    `);
    
    await new Promise<void>((resolve, reject) => {
      db.close((err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    return { stats: (stats as any[])[0], topCallers: topCallers as any[] };
  } catch (error) {
    console.error('Error getting caller stats:', error);
    await new Promise<void>((resolve, reject) => {
      db.close((err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
    return { stats: null, topCallers: [] };
  }
}

export {
  initCallerDatabase,
  findCallsForToken,
  getRecentCalls,
  getCallerStats
};
