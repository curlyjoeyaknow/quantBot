// Migration script to import CSV strategy results into SQLite
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';
import { strategyResultsDb } from './strategy-results-db';
import { dbManager } from '../db-manager';
import { promisify } from 'util';

const EXPORTS_DIR = path.join(process.cwd(), '..', 'data', 'exports');

interface CSVRow {
  TradeNumber?: string;
  TokenAddress: string;
  AlertTime: string;
  EntryTime: string;
  ExitTime: string;
  EntryPrice?: string;
  ExitPrice?: string;
  PnL: string;
  PnLPercent?: string;
  MaxReached: string;
  HoldDurationMinutes: string;
  IsWin?: string;
  Caller?: string;
  Chain?: string;
}

async function findAlertId(tokenAddress: string, alertTime: string): Promise<number | null> {
  const db = await dbManager.getDatabase();
  const get = promisify(db.get.bind(db)) as (query: string, params?: any[]) => Promise<any>;

  // Try to match by token address and approximate alert time (within 1 hour)
  const alertDate = new Date(alertTime);
  const oneHourBefore = new Date(alertDate.getTime() - 60 * 60 * 1000).toISOString();
  const oneHourAfter = new Date(alertDate.getTime() + 60 * 60 * 1000).toISOString();

  const row = await get(
    `SELECT id, caller_name, chain FROM caller_alerts 
     WHERE token_address = ? 
     AND alert_timestamp BETWEEN ? AND ?
     LIMIT 1`,
    [tokenAddress, oneHourBefore, oneHourAfter]
  ) as any;

  return row ? row.id : null;
}

async function migrateCSVFile(csvPath: string, callerName?: string): Promise<{ imported: number; skipped: number; errors: number }> {
  console.log(`\n📂 Migrating: ${csvPath}`);

  if (!fs.existsSync(csvPath)) {
    console.log(`   ❌ File not found`);
    return { imported: 0, skipped: 0, errors: 0 };
  }

  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    cast: false,
  }) as CSVRow[];

  console.log(`   Found ${records.length} rows`);

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of records) {
    try {
      // Parse values
      const tokenAddress = row.TokenAddress?.trim();
      const alertTime = row.AlertTime?.trim();
      const entryTime = row.EntryTime?.trim();
      const exitTime = row.ExitTime?.trim();
      const pnl = parseFloat(row.PnL || '0');
      const maxReached = parseFloat(row.MaxReached || '1.0');
      const holdDuration = parseInt(row.HoldDurationMinutes || '0', 10);
      const entryPrice = row.EntryPrice ? parseFloat(row.EntryPrice) : undefined;
      const exitPrice = row.ExitPrice ? parseFloat(row.ExitPrice) : undefined;

      if (!tokenAddress || !alertTime || !entryTime || !exitTime) {
        skipped++;
        continue;
      }

      // Find matching alert in database
      const alertId = await findAlertId(tokenAddress, alertTime);
      if (!alertId) {
        skipped++;
        continue;
      }

      // Get alert details for caller and chain
      const db = await dbManager.getDatabase();
      const get = promisify(db.get.bind(db)) as (query: string, params?: any[]) => Promise<any>;
      const alert = await get('SELECT caller_name, chain FROM caller_alerts WHERE id = ?', [alertId]) as any | null;

      if (!alert) {
        skipped++;
        continue;
      }

      // Calculate entry/exit prices if not provided
      let finalEntryPrice = entryPrice || 0;
      let finalExitPrice = exitPrice || 0;
      
      if (!entryPrice || !exitPrice) {
        // Estimate from PnL if we have entry price
        if (entryPrice && !exitPrice) {
          finalExitPrice = entryPrice * pnl;
        } else if (!entryPrice && exitPrice) {
          finalEntryPrice = exitPrice / pnl;
        } else {
          // Both missing - use placeholder (will be computed from ClickHouse if needed)
          finalEntryPrice = 1.0;
          finalExitPrice = pnl;
        }
      }

      // Convert timestamps to milliseconds
      const entryTimeMs = new Date(entryTime).getTime();
      const exitTimeMs = new Date(exitTime).getTime();

      // Save to strategy_results
      await strategyResultsDb.saveResult({
        alert_id: alertId,
        token_address: tokenAddress,
        chain: alert.chain || 'solana',
        caller_name: alert.caller_name,
        alert_timestamp: alertTime,
        entry_price: finalEntryPrice,
        exit_price: finalExitPrice,
        pnl: pnl,
        max_reached: maxReached,
        hold_duration_minutes: holdDuration,
        entry_time: entryTimeMs,
        exit_time: exitTimeMs,
        computed_at: new Date().toISOString(),
      });

      imported++;
    } catch (error: any) {
      console.error(`   Error processing row:`, error.message);
      errors++;
    }
  }

  console.log(`   ✅ Imported: ${imported}, ⏭️  Skipped: ${skipped}, ❌ Errors: ${errors}`);
  return { imported, skipped, errors };
}

export async function migrateAllCSVResults(): Promise<void> {
  console.log('🚀 Starting CSV to SQLite migration...\n');

  const csvFiles: Array<{ path: string; caller?: string }> = [];

  // Find all complete_trade_history.csv files
  function findCSVFiles(dir: string, caller?: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        // Check if this is a caller-specific directory
        const callerName = entry.name.replace(/[^a-zA-Z0-9]/g, '_');
        findCSVFiles(fullPath, callerName);
      } else if (entry.isFile() && entry.name.includes('complete_trade_history.csv')) {
        csvFiles.push({ path: fullPath, caller });
      } else if (entry.isFile() && entry.name.includes('trade_history.csv')) {
        csvFiles.push({ path: fullPath, caller });
      } else if (entry.isFile() && entry.name.includes('trade_by_trade.csv')) {
        csvFiles.push({ path: fullPath, caller });
      }
    }
  }

  findCSVFiles(EXPORTS_DIR);

  console.log(`Found ${csvFiles.length} CSV files to migrate\n`);

  let totalImported = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const file of csvFiles) {
    const result = await migrateCSVFile(file.path, file.caller);
    totalImported += result.imported;
    totalSkipped += result.skipped;
    totalErrors += result.errors;
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ Migration complete!`);
  console.log(`   Total imported: ${totalImported}`);
  console.log(`   Total skipped: ${totalSkipped}`);
  console.log(`   Total errors: ${totalErrors}`);
  console.log(`${'='.repeat(80)}\n`);
}

