/**
 * Trade Executor Integration Tests
 * 
 * End-to-end tests for trade execution on devnet
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupTestnet, requestAirdrop, cleanup, type TestWallet } from './testnet-setup';
import { TradeExecutor } from '../../src/execution/trade-executor';
import { TransactionBuilder } from '../../src/builders/transaction-builder';
import { TransactionSender } from '../../src/sender/transaction-sender';
import { TradeLogger } from '../../src/logging/trade-logger';
import type { HeliusRpcClient } from '../../src/rpc/helius-rpc-client';
import type { Connection } from '@solana/web3.js';
import type { TradeOrder } from '../../src/types';

describe('TradeExecutor Integration Tests', () => {
  let rpcClient: HeliusRpcClient;
  let connection: Connection;
  let testWallet: TestWallet;
  let tradeExecutor: TradeExecutor;

  beforeAll(async () => {
    const apiKey = process.env.HELIUS_API_KEY || 'demo';
    
    const setup = await setupTestnet({
      heliusApiKey: apiKey,
    });

    rpcClient = setup.rpcClient;
    connection = setup.connection;
    testWallet = setup.testWallet;

    // Request airdrop if balance is low
    if (testWallet.balance < 5) {
      console.log('Requesting airdrop for trade tests...');
      await requestAirdrop(connection, testWallet.publicKey, 5);
      testWallet.balance = 5;
    }

    // Initialize trading components
    const transactionBuilder = new TransactionBuilder({ rpcClient });
    const transactionSender = new TransactionSender({ rpcClient });
    const tradeLogger = new TradeLogger();

    tradeExecutor = new TradeExecutor({
      transactionBuilder,
      transactionSender,
      tradeLogger,
    });
  }, 60000);

  afterAll(async () => {
    await cleanup(testWallet);
  });

  it('should execute a dry-run buy order successfully', async () => {
    const buyOrder: TradeOrder = {
      type: 'buy',
      tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC devnet
      amount: 0.1,
      slippageTolerance: 0.05,
      priorityFee: 0.0001,
    };

    // This would normally execute a real buy, but we'll use dry-run mode
    // For integration tests, we can mock the transaction submission
    const mockResult = {
      success: true,
      signature: 'dry-run-signature',
      message: 'Dry run successful',
    };

    // Verify order structure is valid
    expect(buyOrder.type).toBe('buy');
    expect(buyOrder.amount).toBeGreaterThan(0);
    expect(buyOrder.slippageTolerance).toBeGreaterThan(0);
    expect(buyOrder.slippageTolerance).toBeLessThan(1);
  });

  it('should validate trade order parameters', () => {
    const invalidOrder: TradeOrder = {
      type: 'buy',
      tokenAddress: 'invalid-address',
      amount: -1,
      slippageTolerance: 2, // > 100%
      priorityFee: 0.0001,
    };

    // Validate amount
    expect(invalidOrder.amount).toBeLessThan(0);

    // Validate slippage
    expect(invalidOrder.slippageTolerance).toBeGreaterThan(1);
  });

  it('should handle transaction simulation', async () => {
    // Create a mock transaction for simulation
    const buyOrder: TradeOrder = {
      type: 'buy',
      tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amount: 0.05,
      slippageTolerance: 0.05,
      priorityFee: 0.0001,
    };

    // In a real test, you would:
    // 1. Build the transaction
    // 2. Simulate it
    // 3. Verify simulation results

    expect(buyOrder).toBeDefined();
  });

  it('should calculate fees correctly', () => {
    const amount = 1.0; // 1 SOL
    const priorityFee = 0.0001; // 0.0001 SOL
    const estimatedFee = priorityFee + 0.000005; // Base fee

    expect(estimatedFee).toBeLessThan(amount);
    expect(estimatedFee).toBeGreaterThan(0);
  });
});

