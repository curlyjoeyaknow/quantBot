#!/usr/bin/env tsx
/**
 * Example: Using Research Services Programmatically
 * 
 * This example demonstrates how to use DataSnapshotService and
 * ExecutionRealityService directly in TypeScript code.
 */

import { createProductionContext } from '@quantbot/workflows';
import {
  createDataSnapshotService,
  createExecutionRealityService,
  type DataSnapshotRef,
  type CreateSnapshotParams,
  type CalibrationData,
  type FeeData,
  type RiskConstraints,
} from '@quantbot/workflows/research';

async function main() {
  console.log('=== Research Services Example ===\n');

  // Create a production context with real dependencies
  const ctx = createProductionContext();

  // ============================================
  // Example 1: Create a Data Snapshot
  // ============================================
  console.log('1. Creating a Data Snapshot...\n');

  const dataService = createDataSnapshotService(ctx);

  const snapshotParams: CreateSnapshotParams = {
    timeRange: {
      fromISO: '2024-01-01T00:00:00Z',
      toISO: '2024-01-02T00:00:00Z',
    },
    sources: [
      {
        venue: 'pump.fun',
        chain: 'solana',
      },
    ],
    filters: {
      callerNames: ['example_caller'], // Optional: filter by caller
    },
  };

  try {
    const snapshot: DataSnapshotRef = await dataService.createSnapshot(snapshotParams);
    console.log('Snapshot created:', {
      snapshotId: snapshot.snapshotId,
      contentHash: snapshot.contentHash.substring(0, 16) + '...',
      timeRange: snapshot.timeRange,
      sources: snapshot.sources,
    });
    console.log('');

    // Verify the snapshot integrity
    const isValid = await dataService.verifySnapshot(snapshot);
    console.log(`Snapshot integrity: ${isValid ? '✓ Valid' : '✗ Invalid'}\n`);
  } catch (error) {
    console.error('Error creating snapshot:', error instanceof Error ? error.message : String(error));
    console.log('(This is expected if database is not configured)\n');
  }

  // ============================================
  // Example 2: Create an Execution Model
  // ============================================
  console.log('2. Creating an Execution Model...\n');

  const executionService = createExecutionRealityService();

  const calibration: CalibrationData = {
    latencySamples: [100, 150, 200, 250, 300, 350, 400, 450, 500],
    slippageSamples: [
      { tradeSize: 100, expectedPrice: 100.0, actualPrice: 100.1 },
      { tradeSize: 200, expectedPrice: 100.0, actualPrice: 100.2 },
      { tradeSize: 300, expectedPrice: 100.0, actualPrice: 100.3 },
      { tradeSize: 400, expectedPrice: 100.0, actualPrice: 100.4 },
      { tradeSize: 500, expectedPrice: 100.0, actualPrice: 100.5 },
    ],
    failureRate: 0.02,
    partialFillRate: 0.1,
  };

  const executionModel = executionService.createExecutionModelFromCalibration(
    calibration,
    'pumpfun'
  );

  console.log('Execution Model:', {
    latency: {
      p50: executionModel.latency.p50,
      p95: executionModel.latency.p95,
      p99: executionModel.latency.p99,
    },
    slippage: {
      p50: executionModel.slippage.p50,
      p95: executionModel.slippage.p95,
    },
    failures: executionModel.failures,
    partialFills: executionModel.partialFills,
  });
  console.log('');

  // Apply the execution model to a trade
  const tradeResult = executionService.applyExecutionModel(
    executionModel,
    {
      size: 1000,
      price: 100.0,
      side: 'buy' as const,
    },
    executionModel.slippage,
    () => Math.random(),
    1000000 // marketVolume24h
  );

  console.log('Trade Execution Result:', {
    executed: tradeResult.executed,
    latency: tradeResult.latency,
    slippage: tradeResult.slippage,
    fillRatio: tradeResult.fillRatio,
  });
  console.log('');

  // ============================================
  // Example 3: Create a Cost Model
  // ============================================
  console.log('3. Creating a Cost Model...\n');

  const fees: FeeData = {
    baseFee: 5000, // lamports
    priorityFee: {
      base: 1000,
      max: 10000,
    },
    tradingFee: 0.01, // 1%
  };

  const costModel = executionService.createCostModelFromFees(fees);

  console.log('Cost Model:', {
    baseFee: costModel.baseFee,
    priorityFee: costModel.priorityFee,
    tradingFee: costModel.tradingFee,
  });
  console.log('');

  // Apply the cost model to a trade
  const costResult = executionService.applyCostModel(costModel, {
    size: 1000,
    price: 100.0,
    side: 'buy' as const,
  });

  console.log('Trade Cost Result:', {
    totalCost: costResult.totalCost,
    baseFee: costResult.baseFee,
    priorityFee: costResult.priorityFee,
    tradingFee: costResult.tradingFee,
  });
  console.log('');

  // ============================================
  // Example 4: Create a Risk Model
  // ============================================
  console.log('4. Creating a Risk Model...\n');

  const riskConstraints: RiskConstraints = {
    maxDrawdown: 0.2, // 20%
    maxLossPerDay: 1000, // SOL
    maxConsecutiveLosses: 5,
    maxPositionSize: 500, // SOL
    tradeThrottle: {
      maxTradesPerMinute: 10,
      maxTradesPerHour: 100,
    },
  };

  const riskModel = executionService.createRiskModelFromConstraints(riskConstraints);

  console.log('Risk Model:', {
    maxDrawdown: riskModel.maxDrawdown,
    maxLossPerDay: riskModel.maxLossPerDay,
    maxConsecutiveLosses: riskModel.maxConsecutiveLosses,
    maxPositionSize: riskModel.maxPositionSize,
    tradeThrottle: riskModel.tradeThrottle,
  });
  console.log('');

  // Check risk constraints for a trade
  const riskCheck = executionService.checkRiskConstraints(riskModel, {
    currentDrawdown: 0.1, // 10%
    dailyLoss: 500, // SOL
    consecutiveLosses: 2,
    positionSize: 200, // SOL
    tradesThisMinute: 5,
    tradesThisHour: 50,
  });

  console.log('Risk Check Result:', {
    allowed: riskCheck.allowed,
    reason: riskCheck.reason || 'OK',
  });
  console.log('');

  // ============================================
  // Example 5: Complete Workflow
  // ============================================
  console.log('5. Complete Research Workflow Example...\n');

  console.log('In a real workflow, you would:');
  console.log('  1. Create a snapshot of historical data');
  console.log('  2. Load the snapshot data');
  console.log('  3. Create execution/cost/risk models');
  console.log('  4. Run simulations with these models');
  console.log('  5. Analyze results');
  console.log('');

  console.log('=== Example Complete ===');
}

// Run the example
main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});

