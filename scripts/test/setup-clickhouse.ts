#!/usr/bin/env tsx
/**
 * Test Setup Script - ClickHouse
 * 
 * Spins up ClickHouse via Docker Compose and initializes test data.
 * This script is run before tests to ensure ClickHouse is available.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import http from 'http';

const MAX_WAIT_TIME = 30000; // 30 seconds
const POLL_INTERVAL = 1000; // 1 second

const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST || 'localhost';

/**
 * Get ClickHouse port (try to detect from Docker or use env/default)
 */
function getClickHousePort(): string {
  // Check environment variable first
  if (process.env.CLICKHOUSE_PORT) {
    return process.env.CLICKHOUSE_PORT;
  }
  
  // Try to detect from docker-compose
  try {
    const psOutput = execSync('docker-compose ps clickhouse', {
      encoding: 'utf-8',
      stdio: 'pipe',
      cwd: process.cwd(),
    });
    // Extract port mapping (e.g., "0.0.0.0:18123->8123/tcp")
    const portMatch = psOutput.match(/(\d+)->8123/);
    if (portMatch) {
      return portMatch[1];
    }
  } catch {
    // Docker compose not available, use default
  }
  
  // Default to Docker Compose port
  return '18123';
}

/**
 * Check if ClickHouse is already running using HTTP request
 */
async function isClickHouseRunning(): Promise<boolean> {
  const detectedPort = getClickHousePort();
  const ports = [detectedPort, '18123', '8123'];
  
  const checkPort = (port: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        req.destroy();
        resolve(false);
      }, 2000);
      
      const req = http.get(
        {
          hostname: CLICKHOUSE_HOST,
          port: parseInt(port, 10),
          path: '/ping',
        },
        (res) => {
          clearTimeout(timer);
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            if (data.trim() === 'Ok') {
              if (port !== detectedPort) {
                process.env.CLICKHOUSE_PORT = port;
              }
              resolve(true);
            } else {
              resolve(false);
            }
          });
        }
      );
      
      req.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  };
  
  // Check ports sequentially (first one that works wins)
  for (const port of ports) {
    try {
      const isRunning = await checkPort(port);
      if (isRunning) {
        return true;
      }
    } catch {
      // Continue to next port
      continue;
    }
  }
  return false;
}

/**
 * Wait for ClickHouse to be ready
 */
async function waitForClickHouse(): Promise<void> {
  const startTime = Date.now();
  const port = getClickHousePort();
  
  while (Date.now() - startTime < MAX_WAIT_TIME) {
    const isRunning = await isClickHouseRunning();
    if (isRunning) {
      console.log(`✅ ClickHouse is ready on port ${process.env.CLICKHOUSE_PORT || port}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    process.stdout.write('.');
  }
  
  throw new Error(`ClickHouse did not become ready within ${MAX_WAIT_TIME}ms (tried ports: ${getClickHousePort()}, 8123, 18123)`);
}

/**
 * Start ClickHouse via Docker Compose
 */
function startClickHouse(): void {
  const dockerComposePath = join(process.cwd(), 'docker-compose.yml');
  
  if (!existsSync(dockerComposePath)) {
    throw new Error(`docker-compose.yml not found at ${dockerComposePath}`);
  }

  console.log('🚀 Starting ClickHouse via Docker Compose...');
  
  try {
    // Check if ClickHouse container is already running
    const psOutput = execSync('docker-compose ps clickhouse', {
      encoding: 'utf-8',
      stdio: 'pipe',
      cwd: process.cwd(),
    });
    
    if (psOutput.includes('Up')) {
      console.log('✅ ClickHouse container is already running');
      return;
    }
  } catch {
    // Container not running, continue to start it
  }

  // Start ClickHouse service
  execSync('docker-compose up -d clickhouse', {
    stdio: 'inherit',
    cwd: process.cwd(),
  });
  
  console.log('⏳ Waiting for ClickHouse to be ready...');
}

/**
 * Initialize ClickHouse schema and test data
 */
async function initializeClickHouse(): Promise<void> {
  console.log('📊 Initializing ClickHouse schema...');
  
  // Import initClickHouse from storage package
  const { initClickHouse } = await import('@quantbot/storage');
  
  try {
    await initClickHouse();
    console.log('✅ ClickHouse schema initialized');
  } catch (error) {
    console.error('❌ Failed to initialize ClickHouse schema:', error);
    throw error;
  }
}

/**
 * Create minimal test data for integration tests
 */
async function createTestData(): Promise<void> {
  console.log('📝 Creating test data...');
  
  const { getClickHouseClient } = await import('@quantbot/storage');
  const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';
  const client = getClickHouseClient();
  
  // Test data: One day of candles for 2025-12-01
  // Using SOL token address as test data
  const testMint = 'So11111111111111111111111111111111111111112';
  const testDate = '2025-12-01';
  
  try {
    // Insert test data for candles_1m (1440 candles = 24 hours * 60 minutes)
    // Note: All candles go into ohlcv_candles table with interval='1m'
    const insert1m = `
      INSERT INTO ${CLICKHOUSE_DATABASE}.ohlcv_candles (token_address, chain, timestamp, interval, open, high, low, close, volume)
      SELECT 
        '${testMint}' as token_address,
        'sol' as chain,
        toDateTime('${testDate} 00:00:00') + INTERVAL number MINUTE as timestamp,
        '1m' as interval,
        toFloat64(1.0 + (number * 0.0001)) as open,
        toFloat64(1.0 + (number * 0.0001) + 0.01) as high,
        toFloat64(1.0 + (number * 0.0001) - 0.01) as low,
        toFloat64(1.0 + (number * 0.0001) + 0.005) as close,
        toFloat64(1000.0 + (number * 10)) as volume
      FROM numbers(1440)
    `;
    
    await client.exec({ query: insert1m });
    console.log('✅ Created 1440 candles_1m records');
    
    // Insert test data for candles_1s (86400 candles = 24 hours * 3600 seconds)
    // Only insert first hour to keep it manageable (3600 candles)
    const insert1s = `
      INSERT INTO ${CLICKHOUSE_DATABASE}.ohlcv_candles (token_address, chain, timestamp, interval, open, high, low, close, volume)
      SELECT 
        '${testMint}' as token_address,
        'sol' as chain,
        toDateTime('${testDate} 00:00:00') + INTERVAL number SECOND as timestamp,
        '1s' as interval,
        toFloat64(1.0 + (number * 0.00001)) as open,
        toFloat64(1.0 + (number * 0.00001) + 0.001) as high,
        toFloat64(1.0 + (number * 0.00001) - 0.001) as low,
        toFloat64(1.0 + (number * 0.00001) + 0.0005) as close,
        toFloat64(100.0 + (number * 0.1)) as volume
      FROM numbers(3600)
    `;
    
    await client.exec({ query: insert1s });
    console.log('✅ Created 3600 candles_1s records (1 hour)');
    
    // Insert test data for candles_15s (5760 candles = 24 hours * 240 intervals)
    const insert15s = `
      INSERT INTO ${CLICKHOUSE_DATABASE}.ohlcv_candles (token_address, chain, timestamp, interval, open, high, low, close, volume)
      SELECT 
        '${testMint}' as token_address,
        'sol' as chain,
        toDateTime('${testDate} 00:00:00') + INTERVAL (number * 15) SECOND as timestamp,
        '15s' as interval,
        toFloat64(1.0 + (number * 0.0001)) as open,
        toFloat64(1.0 + (number * 0.0001) + 0.01) as high,
        toFloat64(1.0 + (number * 0.0001) - 0.01) as low,
        toFloat64(1.0 + (number * 0.0001) + 0.005) as close,
        toFloat64(500.0 + (number * 5)) as volume
      FROM numbers(5760)
    `;
    
    await client.exec({ query: insert15s });
    console.log('✅ Created 5760 candles_15s records');
    
    await client.close();
  } catch (error: any) {
    // If data already exists, that's okay
    if (error?.message?.includes('already exists') || error?.message?.includes('Duplicate')) {
      console.log('ℹ️  Test data already exists, skipping');
    } else {
      console.error('❌ Failed to create test data:', error);
      throw error;
    }
  }
}

/**
 * Main setup function
 */
async function main(): Promise<void> {
  console.log('🔧 Setting up ClickHouse for tests...\n');
  
  try {
    // Check if container is running (faster check)
    let containerRunning = false;
    try {
      const psOutput = execSync('docker-compose ps clickhouse', {
        encoding: 'utf-8',
        stdio: 'pipe',
        cwd: process.cwd(),
      });
      containerRunning = psOutput.includes('Up');
    } catch {
      // Container not running
    }
    
    if (containerRunning) {
      console.log('✅ ClickHouse container is running');
      // If container is running and healthy, assume it's ready
      // (The HTTP check can hang, so we'll proceed with initialization)
      // If initialization fails, the error will be caught below
    } else {
      // Start ClickHouse
      startClickHouse();
      await waitForClickHouse();
    }
    
    // Initialize schema
    await initializeClickHouse();
    
    // Create test data (optional - can be skipped if data exists)
    const skipTestData = process.env.SKIP_TEST_DATA === '1';
    if (!skipTestData) {
      await createTestData();
    } else {
      console.log('⏭️  Skipping test data creation (SKIP_TEST_DATA=1)');
    }
    
    console.log('\n✅ ClickHouse setup complete!');
  } catch (error) {
    console.error('\n❌ ClickHouse setup failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { main as setupClickHouse };

