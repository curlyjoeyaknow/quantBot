#!/usr/bin/env tsx
/**
 * Simple Example: Using ExecutionRealityService
 * 
 * This is a minimal example that doesn't require database connections.
 * It demonstrates creating execution, cost, and risk models.
 */

import {
  createExecutionRealityService,
} from '@quantbot/workflows/research/services/index.js';

async function main() {
  console.log('=== Simple Research Services Example ===\n');

  const service = createExecutionRealityService();

  // Example 1: Create Execution Model
  console.log('1. Creating Execution Model...');
  const executionModel = service.createExecutionModelFromCalibration(
    {
      latencySamples: [100, 150, 200, 250, 300, 350, 400],
      slippageSamples: [
        { tradeSize: 100, expectedPrice: 100.0, actualPrice: 100.1 },
        { tradeSize: 200, expectedPrice: 100.0, actualPrice: 100.2 },
        { tradeSize: 300, expectedPrice: 100.0, actualPrice: 100.3 },
      ],
      failureRate: 0.02,
      partialFillRate: 0.1,
    },
    'pumpfun'
  );

  console.log('Execution Model Created:');
  console.log(`  Latency P50: ${executionModel.latency.p50}ms`);
  console.log(`  Latency P95: ${executionModel.latency.p95}ms`);
  console.log(`  Slippage P50: ${(executionModel.slippage.p50 * 100).toFixed(3)}%`);
  console.log(`  Failure Rate: ${(executionModel.failures.rate * 100).toFixed(2)}%`);
  console.log('');

  // Example 2: Create Cost Model
  console.log('2. Creating Cost Model...');
  const costModel = service.createCostModelFromFees({
    baseFee: 5000,
    priorityFee: { base: 1000, max: 10000 },
    tradingFee: 0.01,
  });

  console.log('Cost Model Created:');
  console.log(`  Base Fee: ${costModel.baseFee} lamports`);
  console.log(`  Priority Fee: ${costModel.priorityFee.base}-${costModel.priorityFee.max} lamports`);
  console.log(`  Trading Fee: ${(costModel.tradingFee * 100).toFixed(2)}%`);
  console.log('');

  // Example 3: Create Risk Model
  console.log('3. Creating Risk Model...');
  const riskModel = service.createRiskModelFromConstraints({
    maxDrawdown: 0.2,
    maxLossPerDay: 1000,
    maxConsecutiveLosses: 5,
    maxPositionSize: 500,
    tradeThrottle: {
      maxTradesPerMinute: 10,
      maxTradesPerHour: 100,
    },
  });

  console.log('Risk Model Created:');
  console.log(`  Max Drawdown: ${(riskModel.maxDrawdown * 100).toFixed(0)}%`);
  console.log(`  Max Loss Per Day: ${riskModel.maxLossPerDay} SOL`);
  console.log(`  Max Consecutive Losses: ${riskModel.maxConsecutiveLosses}`);
  console.log(`  Max Position Size: ${riskModel.maxPositionSize} SOL`);
  console.log('');

  // Example 4: Apply Models to a Trade
  console.log('4. Simulating a Trade...');
  
  const trade = {
    size: 1000,
    price: 100.0,
    side: 'buy' as const,
  };

  // Apply execution model
  const executionResult = service.applyExecutionModel(
    executionModel,
    trade,
    executionModel.slippage,
    () => Math.random(),
    1000000 // marketVolume24h
  );

  console.log('Execution Result:');
  console.log(`  Executed: ${executionResult.executed ? 'Yes' : 'No'}`);
  console.log(`  Latency: ${executionResult.latency}ms`);
  console.log(`  Slippage: ${(executionResult.slippage * 100).toFixed(3)}%`);
  console.log(`  Fill Ratio: ${(executionResult.fillRatio * 100).toFixed(1)}%`);
  console.log('');

  // Apply cost model
  const costResult = service.applyCostModel(costModel, trade);
  console.log('Cost Result:');
  console.log(`  Total Cost: ${costResult.totalCost} lamports`);
  console.log(`  Base Fee: ${costResult.baseFee} lamports`);
  console.log(`  Priority Fee: ${costResult.priorityFee} lamports`);
  console.log(`  Trading Fee: ${costResult.tradingFee} lamports`);
  console.log('');

  // Check risk constraints
  const riskCheck = service.checkRiskConstraints(riskModel, {
    currentDrawdown: 0.1,
    dailyLoss: 500,
    consecutiveLosses: 2,
    positionSize: 200,
    tradesThisMinute: 5,
    tradesThisHour: 50,
  });

  console.log('Risk Check:');
  console.log(`  Allowed: ${riskCheck.allowed ? 'Yes' : 'No'}`);
  if (riskCheck.reason) {
    console.log(`  Reason: ${riskCheck.reason}`);
  }
  console.log('');

  console.log('=== Example Complete ===');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});

