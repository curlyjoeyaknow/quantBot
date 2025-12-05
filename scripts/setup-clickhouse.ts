#!/usr/bin/env ts-node
/**
 * ClickHouse Setup Script
 * 
 * Initializes ClickHouse database and creates necessary tables for OHLCV data storage.
 * Run this once before using ClickHouse for the first time.
 */

import { initClickHouse, closeClickHouse } from '@quantbot/storage';

async function main() {
  console.log('🚀 Setting up ClickHouse database...\n');
  
  try {
    await initClickHouse();
    console.log('\n✅ ClickHouse setup complete!');
    console.log('\nYou can now:');
    console.log('  1. Run migration script to import existing CSV cache');
    console.log('  2. Use ClickHouse for OHLCV data storage');
    console.log('  3. Run simulations with fast ClickHouse queries');
  } catch (error: any) {
    console.error('\n❌ Setup failed:', error.message);
    process.exit(1);
  } finally {
    await closeClickHouse();
  }
}

main();

