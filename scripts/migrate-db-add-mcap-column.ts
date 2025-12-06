#!/usr/bin/env ts-node

/**
 * Database Migration: Add entry_mcap Column
 * 
 * Adds entry_mcap column to caller_alerts table if it doesn't exist
 */

import { Database } from 'sqlite3';
import { promisify } from 'util';
import * as path from 'path';

const DB_PATH = process.env.CALLER_DB_PATH || path.join(process.cwd(), 'data', 'caller_alerts.db');

async function addMcapColumn(): Promise<void> {
  console.log('🔧 Adding entry_mcap column to database...\n');
  
  const db = new Database(DB_PATH);
  const run = promisify(db.run.bind(db)) as (sql: string) => Promise<void>;
  const get = promisify(db.get.bind(db)) as (sql: string) => Promise<any>;
  
  try {
    // Check if column already exists
    const tableInfo = await new Promise<any[]>((resolve, reject) => {
      db.all('PRAGMA table_info(caller_alerts)', (err, rows) => {
        if (err) reject(err);
        else resolve(rows as any[]);
      });
    });
    
    const hasEntryMcap = tableInfo.some((col: any) => col.name === 'entry_mcap');
    
    if (hasEntryMcap) {
      console.log('✅ entry_mcap column already exists');
    } else {
      console.log('📝 Adding entry_mcap column...');
      await run('ALTER TABLE caller_alerts ADD COLUMN entry_mcap REAL');
      console.log('✅ entry_mcap column added successfully');
    }
    
    // Check if we have the index
    const indexes = await new Promise<any[]>((resolve, reject) => {
      db.all('PRAGMA index_list(caller_alerts)', (err, rows) => {
        if (err) reject(err);
        else resolve(rows as any[]);
      });
    });
    
    const hasIndex = indexes.some((idx: any) => idx.name === 'idx_entry_mcap');
    
    if (hasIndex) {
      console.log('✅ Index on entry_mcap already exists');
    } else {
      console.log('📝 Creating index on entry_mcap...');
      await run('CREATE INDEX idx_entry_mcap ON caller_alerts(entry_mcap)');
      console.log('✅ Index created successfully');
    }
    
    // Count tokens
    const stats = await get(`
      SELECT 
        COUNT(*) as total,
        COUNT(entry_mcap) as with_mcap,
        COUNT(*) - COUNT(entry_mcap) as without_mcap
      FROM caller_alerts
    `);
    
    console.log('\n📊 Database Statistics:');
    console.log(`  Total calls:      ${stats.total}`);
    console.log(`  With MCAP:        ${stats.with_mcap}`);
    console.log(`  Without MCAP:     ${stats.without_mcap}`);
    
    if (stats.without_mcap > 0) {
      console.log(`\n💡 Run backfill script to fetch MCAP for ${stats.without_mcap} calls`);
      console.log('   npm run backfill:mcap');
    }
    
    db.close();
    console.log('\n✅ Migration complete!\n');
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    db.close();
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  addMcapColumn()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

export { addMcapColumn };

