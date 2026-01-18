/**
 * Script to:
 * 1. Process Telegram JSON export using Python pipeline
 * 2. Generate caller summary report for period (2026-01-01 to 2026-01-14)
 *    with $25k portfolio simulation, PNL, Fees, Active trades, and complete trade list
 * 
 * Note: This script requires backtest results in backtest_call_results table.
 * If no backtest results exist, it will query calls and provide a summary based on calls only.
 */

import { TelegramPipelineService } from '@quantbot/data/ingestion';
import { PythonEngine } from '@quantbot/infra/utils';
import * as duckdb from 'duckdb';
import * as path from 'path';
import * as fs from 'fs';

// Note: Most up-to-date folder is /home/memez/backups/quantBot-abstraction-only
// Update paths below if using that directory instead
const DB_PATH = process.env.DUCKDB_PATH || path.join(__dirname, '../data/tele.duckdb');
const TELEGRAM_FILE = process.env.TELEGRAM_FILE || path.join(__dirname, 'result.json');
const INITIAL_CAPITAL = 25000;

interface WeeklyReport {
  week: string;
  startDate: string;
  endDate: string;
  portfolio: {
    initialCapital: number;
    finalCapital: number;
    pnl: number;
    pnlPercent: number;
    fees: number;
    activeTrades: number;
  };
  callers: Array<{
    callerName: string;
    calls: number;
    trades: number;
    pnl: number;
    fees: number;
    tradesList: Array<{
      callId: string;
      mint: string;
      entryTime: string;
      exitTime: string;
      entryPrice: number;
      exitPrice: number;
      returnBps: number;
      pnlUsd: number;
      fees: number;
    }>;
  }>;
}

type DuckDbConnection = {
  all<T = any>(sql: string, params: any[], callback: (err: any, rows: T[]) => void): void;
};

async function getDuckDbConnection(): Promise<DuckDbConnection> {
  return new Promise((resolve, reject) => {
    const db = new duckdb.Database(DB_PATH, (err) => {
      if (err) {
        reject(err);
        return;
      }
      db.connect((err, conn) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(conn as DuckDbConnection);
      });
    });
  });
}

async function query<T>(conn: DuckDbConnection, sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    conn.all<T>(sql, params, (err: any, rows: T[]) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function ingestTelegramData() {
  console.log('Starting Telegram Python pipeline...');
  console.log(`File: ${TELEGRAM_FILE}`);
  console.log(`DB: ${DB_PATH}`);

  const pythonEngine = new PythonEngine();
  const pipelineService = new TelegramPipelineService(pythonEngine);

  const result = await pipelineService.runPipeline(
    TELEGRAM_FILE,
    DB_PATH,
    undefined, // chatId - will be extracted from file
    false, // rebuild - append to existing
    { timeout: 30 * 60 * 1000 } // 30 minutes timeout
  );

  console.log('Pipeline complete:', {
    tgNormRows: result.tg_norm_rows,
    callerLinksRows: result.caller_links_rows,
    userCallsRows: result.user_calls_rows,
  });

  return result;
}

async function generateWeeklyReport(
  startDate: Date,
  endDate: Date,
  db: duckdb.Database
): Promise<WeeklyReport> {
  const weekLabel = `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`;

  // Check if backtest_call_results table exists
  let tableCheck: any[] = [];
  try {
    tableCheck = await query<any>(
      db,
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'backtest_call_results'`
    );
  } catch (e) {
    // Try alternative DuckDB syntax
    try {
      tableCheck = await query<any>(
        db,
        `SHOW TABLES LIKE 'backtest_call_results'`
      );
    } catch (e2) {
      // Table might not exist, continue
    }
  }

  let allTrades: any[] = [];
  let leaderboard: any[] = [];

  if (tableCheck.length > 0) {
    // Use backtest results if available
    console.log('Using backtest_call_results table...');
    
    // Get all callers with >50 calls from backtest results
    const callerCounts = await query<any>(
      db,
      `SELECT caller_name, COUNT(*) as calls 
       FROM backtest_call_results 
       GROUP BY caller_name 
       HAVING COUNT(*) > 50`
    );

    if (callerCounts.length === 0) {
      console.log('No callers with >50 calls in backtest results');
      leaderboard = [];
    } else {
      // Get leaderboard for these callers
      const callerNames = callerCounts.map((c) => c.caller_name);
      // DuckDB uses $1, $2, etc. for parameters
      const placeholders = callerNames.map((_, i) => `$${i + 1}`).join(', ');
      
      leaderboard = await query<any>(
        db,
        `SELECT 
          caller_name,
          COUNT(*) as calls,
          SUM(return_bps / 100.0) as agg_pnl_pct_sum,
          AVG(return_bps / 100.0) as avg_pnl_pct,
          AVG(CASE WHEN return_bps > 0 THEN 1 ELSE 0 END) as strike_rate
        FROM backtest_call_results
        WHERE caller_name IN (${placeholders})
        GROUP BY caller_name
        ORDER BY agg_pnl_pct_sum DESC`,
        callerNames
      );

      // Get all trades for this week period
      const tradesPlaceholders = callerNames.map((_, i) => `$${i + 3}`).join(', ');
      const tradesQuery = `
        SELECT 
          bcr.call_id,
          bcr.caller_name,
          bcr.mint,
          bcr.entry_ts_ms,
          bcr.exit_ts_ms,
          bcr.entry_px,
          bcr.exit_px,
          bcr.return_bps,
          bcr.pnl_usd,
          bcr.hold_ms,
          bcr.exit_reason
        FROM backtest_call_results bcr
        WHERE bcr.entry_ts_ms >= $1 
          AND bcr.entry_ts_ms < $2
          AND bcr.caller_name IN (${tradesPlaceholders})
        ORDER BY bcr.entry_ts_ms ASC
      `;

      const params = [startDate.getTime(), endDate.getTime(), ...callerNames];
      allTrades = await query<any>(db, tradesQuery, params);
    }
  } else {
    // Fallback: Query calls from canon.alerts_std or user_calls_d
    console.log('No backtest results found. Querying calls from database...');
    
    // Try to get caller counts from user_calls_d or canon.alerts_std
    let callerCounts: any[] = [];
    try {
      callerCounts = await query<any>(
        db,
        `SELECT caller_name, COUNT(*) as calls 
         FROM user_calls_d 
         WHERE alert_timestamp >= ? AND alert_timestamp < ?
         GROUP BY caller_name 
         HAVING COUNT(*) > 50`,
        [startDate.toISOString(), endDate.toISOString()]
      );
    } catch (e) {
      try {
        callerCounts = await query<any>(
          db,
          `SELECT caller_name, COUNT(*) as calls 
           FROM canon.alerts_std 
           WHERE alert_timestamp >= ? AND alert_timestamp < ?
           GROUP BY caller_name 
           HAVING COUNT(*) > 50`,
          [startDate.toISOString(), endDate.toISOString()]
        );
      } catch (e2) {
        console.log('Could not query calls. Table may not exist yet.');
        leaderboard = [];
      }
    }

    if (callerCounts.length > 0) {
      leaderboard = callerCounts.map((c) => ({
        caller_name: c.caller_name,
        calls: c.calls,
        agg_pnl_pct_sum: 0,
        avg_pnl_pct: 0,
        strike_rate: 0,
      }));

      // For calls without backtest, we can't generate actual trades
      // This is a limitation - backtest needs to be run first
      console.log('WARNING: No backtest results available. Cannot generate trade list.');
      console.log('Please run a backtest first to generate trade results.');
    }
  }

  if (allTrades.length === 0) {
    // No trades available - return empty report structure
    return {
      week: weekLabel,
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      portfolio: {
        initialCapital: INITIAL_CAPITAL,
        finalCapital: INITIAL_CAPITAL,
        pnl: 0,
        pnlPercent: 0,
        fees: 0,
        activeTrades: 0,
      },
      callers: leaderboard.map((caller) => ({
        callerName: caller.caller_name,
        calls: caller.calls,
        trades: 0,
        pnl: 0,
        fees: 0,
        tradesList: [],
      })),
    };
  }

  // Group trades by caller
  const tradesByCaller = new Map<string, typeof allTrades>();
  for (const trade of allTrades) {
    if (!tradesByCaller.has(trade.caller_name)) {
      tradesByCaller.set(trade.caller_name, []);
    }
    tradesByCaller.get(trade.caller_name)!.push(trade);
  }

  // Simulate portfolio for this week using actual backtest results
  // Sort trades by entry time
  const sortedTrades = [...allTrades].sort((a, b) => a.entry_ts_ms - b.entry_ts_ms);

  let freeCash = INITIAL_CAPITAL;
  let totalFees = 0;
  const positions = new Map<string, any>();
  const completedTrades: any[] = [];

  for (const trade of sortedTrades) {
    // Use pnl_usd from backtest if available, otherwise calculate from return_bps
    const returnPct = trade.return_bps / 10000; // Convert bps to decimal
    const positionSize = Math.min(freeCash * 0.05, INITIAL_CAPITAL * 0.1);
    
    if (positionSize < 10 || positions.size >= 10) {
      continue; // Skip if insufficient capital or max positions
    }

    if (positionSize > freeCash) {
      continue; // Skip if insufficient capital
    }

    // Entry fee (0.5%)
    const entryFee = positionSize * 0.005;
    freeCash -= positionSize + entryFee;
    totalFees += entryFee;

    // Calculate exit value based on return
    const exitValue = positionSize * (1 + returnPct);
    const exitFee = exitValue * 0.005;
    const netExitValue = exitValue - exitFee;
    freeCash += netExitValue;
    totalFees += exitFee;

    const netPnl = netExitValue - positionSize - entryFee;

    completedTrades.push({
      ...trade,
      positionSize,
      fees: entryFee + exitFee,
      netPnl,
    });
  }

  const finalCapital = freeCash;
  const pnl = finalCapital - INITIAL_CAPITAL;
  const pnlPercent = (pnl / INITIAL_CAPITAL) * 100;

  // Build caller reports
  const callerReports = leaderboard.map((caller) => {
    const callerCompletedTrades = completedTrades.filter(
      (t) => t.caller_name === caller.caller_name
    );

    const callerPnl = callerCompletedTrades.reduce((sum, t) => sum + (t.netPnl || 0), 0);
    const callerFees = callerCompletedTrades.reduce((sum, t) => sum + (t.fees || 0), 0);

    return {
      callerName: caller.caller_name,
      calls: caller.calls,
      trades: callerCompletedTrades.length,
      pnl: callerPnl,
      fees: callerFees,
      tradesList: callerCompletedTrades.map((t) => ({
        callId: String(t.call_id),
        mint: t.mint,
        entryTime: new Date(t.entry_ts_ms).toISOString(),
        exitTime: new Date(t.exit_ts_ms).toISOString(),
        entryPrice: t.entry_px,
        exitPrice: t.exit_px,
        returnBps: t.return_bps,
        pnlUsd: t.netPnl || 0,
        fees: t.fees || 0,
      })),
    };
  });

  return {
    week: weekLabel,
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
    portfolio: {
      initialCapital: INITIAL_CAPITAL,
      finalCapital,
      pnl,
      pnlPercent,
      fees: totalFees,
      activeTrades: positions.size,
    },
    callers: callerReports,
  };
}

async function main() {
  try {
    // Step 1: Process Telegram data using Python pipeline
    if (!fs.existsSync(TELEGRAM_FILE)) {
      console.error(`Telegram file not found: ${TELEGRAM_FILE}`);
      process.exit(1);
    }

    await ingestTelegramData();

    // Step 2: Generate report for period (2026-01-01 to 2026-01-14)
    const db = await getDuckDbConnection();
    
    // Note: The user said "last 7 weeks" but the date range is 2026-01-01 to 2026-01-14 which is 2 weeks
    // I'll generate a report for that period
    const startDate = new Date('2026-01-01T00:00:00Z');
    const endDate = new Date('2026-01-15T00:00:00Z'); // Exclusive end

    console.log('\nGenerating caller summary report...');
    console.log(`Period: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

    const report = await generateWeeklyReport(startDate, endDate, db);

    // Output report
    const outputPath = path.join(__dirname, 'caller-summary-report.json');
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

    // Database connection will be closed automatically

    console.log('\n=== CALLER SUMMARY REPORT ===');
    console.log(`Week: ${report.week}`);
    console.log(`\nPortfolio Performance:`);
    console.log(`  Initial Capital: $${report.portfolio.initialCapital.toFixed(2)}`);
    console.log(`  Final Capital: $${report.portfolio.finalCapital.toFixed(2)}`);
    console.log(`  PNL: $${report.portfolio.pnl.toFixed(2)} (${report.portfolio.pnlPercent.toFixed(2)}%)`);
    console.log(`  Total Fees: $${report.portfolio.fees.toFixed(2)}`);
    console.log(`  Active Trades: ${report.portfolio.activeTrades}`);

    console.log(`\nCallers (${report.callers.length} with >50 calls):`);
    for (const caller of report.callers) {
      console.log(`\n  ${caller.callerName}:`);
      console.log(`    Calls: ${caller.calls}`);
      console.log(`    Trades: ${caller.trades}`);
      console.log(`    PNL: $${caller.pnl.toFixed(2)}`);
      console.log(`    Fees: $${caller.fees.toFixed(2)}`);
      console.log(`    Trade List: ${caller.tradesList.length} trades`);
    }

    console.log(`\nFull report saved to: ${outputPath}`);

    db.close();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
