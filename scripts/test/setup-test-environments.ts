#!/usr/bin/env tsx
/**
 * Test Environment Setup Script
 *
 * Automatically sets up test environments (Python, DuckDB, ClickHouse) before running tests.
 * This script can be run manually or automatically via test hooks.
 *
 * Usage:
 *   tsx scripts/test/setup-test-environments.ts
 *   AUTO_SETUP_ENV=1 pnpm test  # Automatically runs this script
 */

import {
  setupAllEnvironments,
  checkAllEnvironments,
  setupPythonEnvironment,
  setupClickHouseEnvironment,
} from '../../packages/utils/src/test-helpers/test-environment-setup.js';

async function main() {
  console.log('[test-setup] Checking test environments...\n');

  try {
    // Check current status
    const status = checkAllEnvironments();
    console.log('[test-setup] Current environment status:');
    console.log(
      `  Python 3: ${status.python.python3Available ? '✓' : '✗'} ${status.python.python3Version || 'not available'}`
    );
    console.log(`  Python deps: ${status.python.dependenciesInstalled ? '✓' : '✗'}`);
    console.log(
      `  DuckDB: ${status.duckdb.duckdbAvailable ? '✓' : '✗'} (writeable: ${status.duckdb.writeable ? '✓' : '✗'})`
    );
    console.log(
      `  ClickHouse: ${status.clickhouse.clickhouseAvailable ? '✓' : '✗'} (${status.clickhouse.host}:${status.clickhouse.port})`
    );
    console.log(`  All ready: ${status.allReady ? '✓' : '✗'}\n`);

    if (status.allReady) {
      console.log('[test-setup] All environments are ready. No setup needed.\n');
      process.exit(0);
    }

    console.log('[test-setup] Setting up missing environments...\n');

    // Setup Python if needed
    if (!status.python.python3Available || !status.python.dependenciesInstalled) {
      console.log('[test-setup] Setting up Python environment...');
      try {
        await setupPythonEnvironment();
        console.log('[test-setup] ✓ Python environment ready\n');
      } catch (error) {
        console.error('[test-setup] ✗ Failed to setup Python environment:', error);
        console.error('[test-setup] Please install Python 3.8+ and dependencies manually\n');
      }
    }

    // Setup ClickHouse if needed
    if (!status.clickhouse.clickhouseAvailable) {
      console.log('[test-setup] Setting up ClickHouse...');
      try {
        await setupClickHouseEnvironment();
        console.log('[test-setup] ✓ ClickHouse ready\n');
      } catch (error) {
        console.error('[test-setup] ✗ Failed to setup ClickHouse:', error);
        console.error(
          '[test-setup] Please start ClickHouse manually: docker-compose up -d clickhouse\n'
        );
      }
    }

    // Final status check
    const finalStatus = checkAllEnvironments();
    console.log('[test-setup] Final environment status:');
    console.log(`  Python 3: ${finalStatus.python.python3Available ? '✓' : '✗'}`);
    console.log(`  Python deps: ${finalStatus.python.dependenciesInstalled ? '✓' : '✗'}`);
    console.log(`  DuckDB: ${finalStatus.duckdb.duckdbAvailable ? '✓' : '✗'}`);
    console.log(`  ClickHouse: ${finalStatus.clickhouse.clickhouseAvailable ? '✓' : '✗'}`);
    console.log(`  All ready: ${finalStatus.allReady ? '✓' : '✗'}\n`);

    if (finalStatus.allReady) {
      console.log('[test-setup] ✓ All test environments are ready!\n');
      process.exit(0);
    } else {
      console.warn('[test-setup] ⚠ Some environments are not ready. Some tests may be skipped.\n');
      process.exit(0); // Don't fail - tests will skip gracefully
    }
  } catch (error) {
    console.error('[test-setup] ✗ Setup failed:', error);
    process.exit(1);
  }
}

main();
