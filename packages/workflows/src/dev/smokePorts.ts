/**
 * Unified Port Smoke Tests
 *
 * Runs all port smoke tests in sequence.
 * This ensures all ports are properly wired and working.
 */

import { smokeMarketDataPort } from './smokeMarketDataPort.js';
import { smokeStatePort } from './smokeStatePort.js';

export async function smokeAllPorts(): Promise<void> {
  console.log('🧪 Running all port smoke tests...\n');

  try {
    // Test MarketDataPort
    console.log('📊 Testing MarketDataPort...');
    await smokeMarketDataPort();
    console.log('');

    // Test StatePort
    console.log('💾 Testing StatePort...');
    await smokeStatePort();
    console.log('');

    // TODO: Add ExecutionPort smoke test when created
    // console.log('⚡ Testing ExecutionPort...');
    // await smokeExecutionPort();
    // console.log('');

    console.log('✅ All port smoke tests passed!\n');
  } catch (error) {
    console.error('❌ Port smoke tests failed:', error);
    throw error;
  }
}

// Allow running directly: tsx packages/workflows/src/dev/smokePorts.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  smokeAllPorts()
    .then(() => {
      console.log('Smoke tests completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Smoke tests failed:', error);
      process.exit(1);
    });
}
