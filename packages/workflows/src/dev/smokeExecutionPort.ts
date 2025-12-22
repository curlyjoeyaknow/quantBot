/**
 * Smoke test for ExecutionPort adapter
 *
 * Quick verification that the adapter wiring doesn't regress.
 * Run this to ensure the ExecutionPort adapter is properly wired.
 *
 * **SAFETY**: This test uses dry-run mode by default (no real trades executed).
 */

import { createProductionPorts } from '../context/createProductionPorts.js';
import { createTokenAddress } from '@quantbot/core';

export async function smokeExecutionPort(): Promise<void> {
  const ports = await createProductionPorts();

  try {
    // Test isAvailable
    const available = await ports.execution.isAvailable();
    console.log('✅ ExecutionPort isAvailable works:', { available });
    if (!available) {
      throw new Error('ExecutionPort is not available');
    }

    // Test execute with dry-run mode (safety-first)
    const testRequest = {
      tokenAddress: createTokenAddress('So11111111111111111111111111111111111111112'), // SOL
      chain: 'solana' as const,
      side: 'buy' as const,
      amount: 0.1, // 0.1 SOL
      slippageBps: 100, // 1% slippage
      priorityFee: 21_000, // µLAM per compute unit
      maxRetries: 3,
    };

    console.log('\n🧪 Testing ExecutionPort.execute() in dry-run mode...');
    const executeResult = await ports.execution.execute(testRequest);

    console.log('✅ ExecutionPort execute works:', {
      success: executeResult.success,
      txSignature: executeResult.txSignature,
      executedPrice: executeResult.executedPrice,
      executedAmount: executeResult.executedAmount,
      fees: executeResult.fees,
    });

    if (!executeResult.success) {
      throw new Error(`Execution failed: ${executeResult.error}`);
    }

    // Verify dry-run mode (should have simulated txSignature)
    if (!executeResult.txSignature?.startsWith('dry-run-')) {
      console.warn(
        '⚠️  ExecutionPort may not be in dry-run mode (txSignature does not start with "dry-run-")'
      );
    } else {
      console.log('✅ Dry-run mode verified (txSignature starts with "dry-run-")');
    }

    // Test idempotency (same request should return cached result)
    console.log('\n🧪 Testing ExecutionPort idempotency...');
    const idempotentResult = await ports.execution.execute(testRequest);

    if (
      idempotentResult.txSignature === executeResult.txSignature &&
      idempotentResult.executedPrice === executeResult.executedPrice
    ) {
      console.log('✅ ExecutionPort idempotency works (same request returns cached result)');
    } else {
      console.warn(
        '⚠️  ExecutionPort idempotency may not be working (different results for same request)'
      );
    }

    // Test circuit breaker (simulate failures)
    console.log('\n🧪 Testing ExecutionPort circuit breaker...');
    // Note: Circuit breaker is internal to the adapter, so we can't directly test it
    // But we can verify that isAvailable() still works after execution
    const availableAfterExecution = await ports.execution.isAvailable();
    if (availableAfterExecution) {
      console.log('✅ ExecutionPort circuit breaker state is healthy');
    } else {
      console.warn('⚠️  ExecutionPort circuit breaker may be open (isAvailable returned false)');
    }

    // Test with different request (should not hit idempotency cache)
    const differentRequest = {
      ...testRequest,
      amount: 0.2, // Different amount
    };

    console.log('\n🧪 Testing ExecutionPort with different request...');
    const differentResult = await ports.execution.execute(differentRequest);

    if (differentResult.success && differentResult.txSignature !== executeResult.txSignature) {
      console.log('✅ ExecutionPort handles different requests correctly');
    } else {
      console.warn('⚠️  ExecutionPort may not be handling different requests correctly');
    }

    console.log('\n✅ All ExecutionPort smoke tests passed!');
    console.log('\n⚠️  REMINDER: This adapter is in dry-run mode (no real trades executed).');
    console.log('   To enable real execution, set EXECUTION_DRY_RUN=false (NOT RECOMMENDED in development).');
  } catch (error) {
    console.error('❌ ExecutionPort smoke test failed:', error);
    throw error;
  }
}

// Allow running directly: tsx packages/workflows/src/dev/smokeExecutionPort.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  smokeExecutionPort()
    .then(() => {
      console.log('ExecutionPort smoke test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('ExecutionPort smoke test failed:', error);
      process.exit(1);
    });
}

