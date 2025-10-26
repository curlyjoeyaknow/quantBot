import { Database } from 'sqlite3';
import { promisify } from 'util';
import { config } from 'dotenv';

config();

export interface CallerAlert {
  id?: number;
  callerName: string;
  tokenAddress: string;
  tokenSymbol?: string;
  chain: string;
  alertTimestamp: Date;
  alertMessage?: string;
  priceAtAlert?: number;
  volumeAtAlert?: number;
  createdAt: Date;
}

export interface CallerStats {
  callerName: string;
  totalAlerts: number;
  uniqueTokens: number;
  firstAlert: Date;
  lastAlert: Date;
  avgAlertsPerDay: number;
  successRate?: number; // Will be calculated from simulation results
}

export class CallerDatabase {
  private db: Database;
  private dbPath: string;

  constructor(dbPath: string = process.env.CALLER_DB_PATH || './caller_alerts.db') {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    this.initDatabase();
  }

  /**
   * Initialize database tables
   */
  private async initDatabase(): Promise<void> {
    const run = promisify(this.db.run.bind(this.db));

    try {
      // Create caller_alerts table
      await run(`
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
      `);

      // Create indexes for better query performance
      await run(`CREATE INDEX IF NOT EXISTS idx_caller_name ON caller_alerts(caller_name)`);
      await run(`CREATE INDEX IF NOT EXISTS idx_token_address ON caller_alerts(token_address)`);
      await run(`CREATE INDEX IF NOT EXISTS idx_alert_timestamp ON caller_alerts(alert_timestamp)`);
      await run(`CREATE INDEX IF NOT EXISTS idx_caller_timestamp ON caller_alerts(caller_name, alert_timestamp)`);

      // Create caller_stats table for aggregated statistics
      await run(`
        CREATE TABLE IF NOT EXISTS caller_stats (
          caller_name TEXT PRIMARY KEY,
          total_alerts INTEGER NOT NULL,
          unique_tokens INTEGER NOT NULL,
          first_alert DATETIME NOT NULL,
          last_alert DATETIME NOT NULL,
          avg_alerts_per_day REAL NOT NULL,
          success_rate REAL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      console.log('✅ Caller database initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize caller database:', error);
      throw error;
    }
  }

  /**
   * Add a new caller alert
   */
  async addCallerAlert(alert: CallerAlert): Promise<number> {
    const run = promisify(this.db.run.bind(this.db));

    try {
      const result = await run(`
        INSERT OR IGNORE INTO caller_alerts 
        (caller_name, token_address, token_symbol, chain, alert_timestamp, alert_message, price_at_alert, volume_at_alert)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        alert.callerName,
        alert.tokenAddress.toLowerCase(),
        alert.tokenSymbol,
        alert.chain,
        alert.alertTimestamp.toISOString(),
        alert.alertMessage,
        alert.priceAtAlert,
        alert.volumeAtAlert
      ]);

      return (result as any).lastID;
    } catch (error) {
      console.error('❌ Failed to add caller alert:', error);
      throw error;
    }
  }

  /**
   * Batch add multiple caller alerts
   */
  async addCallerAlertsBatch(alerts: CallerAlert[]): Promise<number> {
    const run = promisify(this.db.run.bind(this.db));

    try {
      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO caller_alerts 
        (caller_name, token_address, token_symbol, chain, alert_timestamp, alert_message, price_at_alert, volume_at_alert)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let addedCount = 0;
      for (const alert of alerts) {
        try {
          await new Promise((resolve, reject) => {
            stmt.run([
              alert.callerName,
              alert.tokenAddress.toLowerCase(),
              alert.tokenSymbol,
              alert.chain,
              alert.alertTimestamp.toISOString(),
              alert.alertMessage,
              alert.priceAtAlert,
              alert.volumeAtAlert
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
            console.warn(`⚠️ Failed to add alert for ${alert.callerName}: ${error.message}`);
          }
        }
      }

      stmt.finalize();
      console.log(`✅ Added ${addedCount}/${alerts.length} caller alerts`);
      return addedCount;
    } catch (error) {
      console.error('❌ Failed to batch add caller alerts:', error);
      throw error;
    }
  }

  /**
   * Get all alerts for a specific caller
   */
  async getCallerAlerts(callerName: string, limit?: number): Promise<CallerAlert[]> {
    const all = promisify(this.db.all.bind(this.db));

    try {
      const query = limit 
        ? `SELECT * FROM caller_alerts WHERE caller_name = ? ORDER BY alert_timestamp DESC LIMIT ?`
        : `SELECT * FROM caller_alerts WHERE caller_name = ? ORDER BY alert_timestamp DESC`;

      const params = limit ? [callerName, limit] : [callerName];
      const rows = await all(query, params);

      return rows.map((row: any) => ({
        id: row.id,
        callerName: row.caller_name,
        tokenAddress: row.token_address,
        tokenSymbol: row.token_symbol,
        chain: row.chain,
        alertTimestamp: new Date(row.alert_timestamp),
        alertMessage: row.alert_message,
        priceAtAlert: row.price_at_alert,
        volumeAtAlert: row.volume_at_alert,
        createdAt: new Date(row.created_at)
      }));
    } catch (error) {
      console.error('❌ Failed to get caller alerts:', error);
      throw error;
    }
  }

  /**
   * Get alerts for a caller within a time range
   */
  async getCallerAlertsInRange(
    callerName: string, 
    startTime: Date, 
    endTime: Date
  ): Promise<CallerAlert[]> {
    const all = promisify(this.db.all.bind(this.db));

    try {
      const rows = await all(`
        SELECT * FROM caller_alerts 
        WHERE caller_name = ? 
        AND alert_timestamp >= ? 
        AND alert_timestamp <= ?
        ORDER BY alert_timestamp ASC
      `, [callerName, startTime.toISOString(), endTime.toISOString()]);

      return rows.map((row: any) => ({
        id: row.id,
        callerName: row.caller_name,
        tokenAddress: row.token_address,
        tokenSymbol: row.token_symbol,
        chain: row.chain,
        alertTimestamp: new Date(row.alert_timestamp),
        alertMessage: row.alert_message,
        priceAtAlert: row.price_at_alert,
        volumeAtAlert: row.volume_at_alert,
        createdAt: new Date(row.created_at)
      }));
    } catch (error) {
      console.error('❌ Failed to get caller alerts in range:', error);
      throw error;
    }
  }

  /**
   * Get all unique callers
   */
  async getAllCallers(): Promise<string[]> {
    const all = promisify(this.db.all.bind(this.db));

    try {
      const rows = await all(`SELECT DISTINCT caller_name FROM caller_alerts ORDER BY caller_name`);
      return rows.map((row: any) => row.caller_name);
    } catch (error) {
      console.error('❌ Failed to get all callers:', error);
      throw error;
    }
  }

  /**
   * Get caller statistics
   */
  async getCallerStats(callerName: string): Promise<CallerStats | null> {
    const all = promisify(this.db.all.bind(this.db));

    try {
      const rows = await all(`
        SELECT 
          caller_name,
          COUNT(*) as total_alerts,
          COUNT(DISTINCT token_address) as unique_tokens,
          MIN(alert_timestamp) as first_alert,
          MAX(alert_timestamp) as last_alert,
          COUNT(*) * 1.0 / (julianday(MAX(alert_timestamp)) - julianday(MIN(alert_timestamp)) + 1) as avg_alerts_per_day
        FROM caller_alerts 
        WHERE caller_name = ?
        GROUP BY caller_name
      `, [callerName]);

      if (rows.length === 0) return null;

      const row = rows[0];
      return {
        callerName: row.caller_name,
        totalAlerts: row.total_alerts,
        uniqueTokens: row.unique_tokens,
        firstAlert: new Date(row.first_alert),
        lastAlert: new Date(row.last_alert),
        avgAlertsPerDay: parseFloat(row.avg_alerts_per_day.toFixed(2))
      };
    } catch (error) {
      console.error('❌ Failed to get caller stats:', error);
      throw error;
    }
  }

  /**
   * Get all caller statistics
   */
  async getAllCallerStats(): Promise<CallerStats[]> {
    const all = promisify(this.db.all.bind(this.db));

    try {
      const rows = await all(`
        SELECT 
          caller_name,
          COUNT(*) as total_alerts,
          COUNT(DISTINCT token_address) as unique_tokens,
          MIN(alert_timestamp) as first_alert,
          MAX(alert_timestamp) as last_alert,
          COUNT(*) * 1.0 / (julianday(MAX(alert_timestamp)) - julianday(MIN(alert_timestamp)) + 1) as avg_alerts_per_day
        FROM caller_alerts 
        GROUP BY caller_name
        ORDER BY total_alerts DESC
      `);

      return rows.map((row: any) => ({
        callerName: row.caller_name,
        totalAlerts: row.total_alerts,
        uniqueTokens: row.unique_tokens,
        firstAlert: new Date(row.first_alert),
        lastAlert: new Date(row.last_alert),
        avgAlertsPerDay: parseFloat(row.avg_alerts_per_day.toFixed(2))
      }));
    } catch (error) {
      console.error('❌ Failed to get all caller stats:', error);
      throw error;
    }
  }

  /**
   * Get tokens called by a specific caller
   */
  async getCallerTokens(callerName: string): Promise<Array<{tokenAddress: string, tokenSymbol: string, chain: string, alertCount: number}>> {
    const all = promisify(this.db.all.bind(this.db));

    try {
      const rows = await all(`
        SELECT 
          token_address,
          token_symbol,
          chain,
          COUNT(*) as alert_count
        FROM caller_alerts 
        WHERE caller_name = ?
        GROUP BY token_address, token_symbol, chain
        ORDER BY alert_count DESC
      `, [callerName]);

      return rows.map((row: any) => ({
        tokenAddress: row.token_address,
        tokenSymbol: row.token_symbol,
        chain: row.chain,
        alertCount: row.alert_count
      }));
    } catch (error) {
      console.error('❌ Failed to get caller tokens:', error);
      throw error;
    }
  }

  /**
   * Update caller success rate (called after simulations)
   */
  async updateCallerSuccessRate(callerName: string, successRate: number): Promise<void> {
    const run = promisify(this.db.run.bind(this.db));

    try {
      await run(`
        INSERT OR REPLACE INTO caller_stats 
        (caller_name, total_alerts, unique_tokens, first_alert, last_alert, avg_alerts_per_day, success_rate, updated_at)
        SELECT 
          caller_name,
          COUNT(*) as total_alerts,
          COUNT(DISTINCT token_address) as unique_tokens,
          MIN(alert_timestamp) as first_alert,
          MAX(alert_timestamp) as last_alert,
          COUNT(*) * 1.0 / (julianday(MAX(alert_timestamp)) - julianday(MIN(alert_timestamp)) + 1) as avg_alerts_per_day,
          ? as success_rate,
          CURRENT_TIMESTAMP as updated_at
        FROM caller_alerts 
        WHERE caller_name = ?
        GROUP BY caller_name
      `, [successRate, callerName]);

      console.log(`✅ Updated success rate for ${callerName}: ${successRate.toFixed(2)}%`);
    } catch (error) {
      console.error('❌ Failed to update caller success rate:', error);
      throw error;
    }
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats(): Promise<{
    totalAlerts: number;
    totalCallers: number;
    totalTokens: number;
    dateRange: {start: Date, end: Date};
  }> {
    const all = promisify(this.db.all.bind(this.db));

    try {
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
    } catch (error) {
      console.error('❌ Failed to get database stats:', error);
      throw error;
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else {
          console.log('🔌 Caller database connection closed');
          resolve();
        }
      });
    });
  }
}

// Export singleton instance
export const callerDatabase = new CallerDatabase();
