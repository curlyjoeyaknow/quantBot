/**
 * Smoke test for StatePort adapter
 *
 * Quick verification that the adapter wiring doesn't regress.
 * Run this to ensure the DuckDB state adapter is properly wired.
 */

import { AppError } from '@quantbot/utils';
import { createProductionPorts } from '../context/createProductionPorts.js';

export async function smokeStatePort(): Promise<void> {
  const ports = await createProductionPorts();

  try {
    // Test isAvailable
    const available = await ports.state.isAvailable();
    console.log('✅ StatePort isAvailable works:', { available });

    if (!available) {
      console.log('⚠️  StatePort not available (DuckDB may not be initialized)');
      return;
    }

    // Test set
    const setResult = await ports.state.set({
      key: 'smoke_test',
      value: { test: true, timestamp: Date.now() },
      namespace: 'smoke_tests',
      ttlSeconds: 60,
    });

    console.log('✅ StatePort set works:', { success: setResult.success });

    if (!setResult.success) {
      console.error('❌ StatePort set failed:', setResult.error);
      throw new AppError(`StatePort set failed: ${setResult.error}`, 'STATE_PORT_SET_FAILED', 500, {
        setResult,
      });
    }

    // Test get
    const getResult = await ports.state.get<{ test: boolean; timestamp: number }>({
      key: 'smoke_test',
      namespace: 'smoke_tests',
    });

    console.log('✅ StatePort get works:', {
      found: getResult.found,
      value: getResult.value,
    });

    if (!getResult.found) {
      throw new AppError(
        'StatePort get failed: value not found after set',
        'STATE_PORT_GET_FAILED',
        500,
        {
          getResult,
        }
      );
    }

    // Test delete
    const deleteResult = await ports.state.delete({
      key: 'smoke_test',
      namespace: 'smoke_tests',
    });

    console.log('✅ StatePort delete works:', { success: deleteResult.success });

    if (!deleteResult.success) {
      console.error('❌ StatePort delete failed:', deleteResult.error);
      throw new Error(`StatePort delete failed: ${deleteResult.error}`);
    }

    // Verify deleted
    const getAfterDelete = await ports.state.get({
      key: 'smoke_test',
      namespace: 'smoke_tests',
    });

    console.log('✅ StatePort delete verified:', { found: getAfterDelete.found });

    if (getAfterDelete.found) {
      throw new Error('StatePort delete failed: value still exists after delete');
    }

    console.log('✅ All StatePort core operations smoke tests passed!');
  } catch (error) {
    console.error('❌ StatePort smoke test failed:', error);
    throw error;
  }
}

// Allow running directly: tsx packages/workflows/src/dev/smokeStatePort.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  smokeStatePort()
    .then(() => {
      console.log('Smoke test completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Smoke test failed:', error);
      process.exit(1);
    });
}
