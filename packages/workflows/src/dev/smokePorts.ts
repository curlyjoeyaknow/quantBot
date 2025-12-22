/**
 * Smoke test for all production ports
 *
 * Quick verification that port adapters are properly wired.
 * Run this to ensure ports don't regress.
 *
 * Usage:
 *   pnpm smoke:ports
 *   tsx packages/workflows/src/dev/smokePorts.ts
 */

import { createProductionPorts } from '../context/createProductionPorts.js';
import { createTokenAddress } from '@quantbot/core';
import { resolve } from 'path';

export async function smokePorts(duckdbPath?: string): Promise<void> {
  console.log('🔥 Smoking ports...\n');

  // Use provided path or default (resolved from workspace root as absolute path)
  const defaultPath = resolve(process.cwd(), process.env.DUCKDB_PATH || 'data/tele.duckdb');
  const dbPath = duckdbPath ? resolve(process.cwd(), duckdbPath) : defaultPath;
  const ports = await createProductionPorts(dbPath);

  // Test MarketDataPort
  console.log('Testing MarketDataPort...');
  try {
    const solMint = createTokenAddress('So11111111111111111111111111111111111111112');
    
    const metadata = await ports.marketData.fetchMetadata({
      tokenAddress: solMint,
      chain: 'solana',
    });
    console.log('  ✅ MarketDataPort.fetchMetadata:', metadata ? 'OK' : 'null (may be expected)');

    const now = Math.floor(Date.now() / 1000);
    const oneHourAgo = now - 3600;
    const candles = await ports.marketData.fetchOhlcv({
      tokenAddress: solMint,
      chain: 'solana',
      interval: '1m',
      from: oneHourAgo,
      to: now,
    });
    console.log(`  ✅ MarketDataPort.fetchOhlcv: ${candles.length} candles`);
  } catch (error) {
    console.error('  ❌ MarketDataPort failed:', error);
    throw error;
  }

  // Test StatePort
  console.log('\nTesting StatePort...');
  try {
    const testKey = 'smoke_test_key';
    const testValue = { test: true, timestamp: Date.now() };

    // Test set
    const setResult = await ports.state.set({
      key: testKey,
      namespace: 'smoke_test',
      value: testValue,
    });
    if (!setResult.success) {
      throw new Error(`StatePort.set failed: ${setResult.error}`);
    }
    console.log('  ✅ StatePort.set: OK');

    // Test get
    const getResult = await ports.state.get({
      key: testKey,
      namespace: 'smoke_test',
    });
    if (!getResult.found) {
      throw new Error('StatePort.get: key not found after set');
    }
    console.log('  ✅ StatePort.get: OK');

    // Test delete
    const deleteResult = await ports.state.delete({
      key: testKey,
      namespace: 'smoke_test',
    });
    if (!deleteResult.success) {
      throw new Error(`StatePort.delete failed: ${deleteResult.error}`);
    }
    console.log('  ✅ StatePort.delete: OK');

    // Verify deleted
    const verifyResult = await ports.state.get({
      key: testKey,
      namespace: 'smoke_test',
    });
    if (verifyResult.found) {
      throw new Error('StatePort.get: key still found after delete');
    }
    console.log('  ✅ StatePort.delete verification: OK');

    // Test isAvailable
    const isAvailable = await ports.state.isAvailable();
    if (!isAvailable) {
      throw new Error('StatePort.isAvailable: returned false');
    }
    console.log('  ✅ StatePort.isAvailable: OK');
  } catch (error) {
    console.error('  ❌ StatePort failed:', error);
    throw error;
  }

  // Test TelemetryPort
  console.log('\nTesting TelemetryPort...');
  try {
    ports.telemetry.emitEvent({
      name: 'smoke_test_event',
      level: 'info',
      message: 'Smoke test event',
      timestamp: ports.clock.nowMs(),
    });
    console.log('  ✅ TelemetryPort.emitEvent: OK');

    ports.telemetry.emitMetric({
      name: 'smoke_test_metric',
      type: 'counter',
      value: 1,
      timestamp: ports.clock.nowMs(),
    });
    console.log('  ✅ TelemetryPort.emitMetric: OK');

    const span = ports.telemetry.startSpan('smoke_test_span', 'test');
    ports.telemetry.endSpan(span);
    console.log('  ✅ TelemetryPort.startSpan/endSpan: OK');
  } catch (error) {
    console.error('  ❌ TelemetryPort failed:', error);
    throw error;
  }

  // Test ClockPort
  console.log('\nTesting ClockPort...');
  try {
    const now1 = ports.clock.nowMs();
    const now2 = ports.clock.nowMs();
    if (now2 < now1) {
      throw new Error('ClockPort.nowMs: time went backwards');
    }
    console.log('  ✅ ClockPort.nowMs: OK');
  } catch (error) {
    console.error('  ❌ ClockPort failed:', error);
    throw error;
  }

  console.log('\n✅ All ports smoke tests passed!');
}

// Allow running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  smokePorts()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('Smoke test failed:', error);
      process.exit(1);
    });
}

