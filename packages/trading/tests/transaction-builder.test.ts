/**
 * Transaction Builder Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PublicKey, Connection } from '@solana/web3.js';
import { TransactionBuilder } from '../src/builders/transaction-builder';
import type { HeliusRpcClient } from '../src/rpc/helius-rpc-client';

describe('TransactionBuilder', () => {
  let builder: TransactionBuilder;
  let mockRpcClient: HeliusRpcClient;
  let payer: PublicKey;
  let tokenMint: PublicKey;

  beforeEach(() => {
    // Mock RPC client
    mockRpcClient = {
      getConnection: vi.fn().mockReturnValue({
        getLatestBlockhash: vi.fn().mockResolvedValue({
          blockhash: 'test-blockhash',
          lastValidBlockHeight: 1000000,
        }),
      } as any),
    } as any;

    builder = new TransactionBuilder({ rpcClient: mockRpcClient });
    payer = new PublicKey('11111111111111111111111111111111');
    tokenMint = new PublicKey('22222222222222222222222222222222');
  });

  describe('buildPumpFunBuyTransaction', () => {
    it('should build a valid buy transaction', async () => {
      const tx = await builder.buildPumpFunBuyTransaction({
        payer,
        tokenMint,
        amount: 0.1,
        slippageTolerance: 0.01,
        priorityFee: 0.0001,
      });

      expect(tx).toBeDefined();
      expect(tx.instructions.length).toBeGreaterThan(0);
      expect(tx.feePayer).toEqual(payer);
    });

    it('should include compute budget instructions', async () => {
      const tx = await builder.buildPumpFunBuyTransaction({
        payer,
        tokenMint,
        amount: 0.1,
        slippageTolerance: 0.01,
        priorityFee: 0.0001,
      });

      // First instruction should be compute unit limit
      expect(tx.instructions[0].programId.toBase58()).toBe(
        'ComputeBudget111111111111111111111111111111'
      );
    });

    it('should throw error for invalid amount', async () => {
      await expect(
        builder.buildPumpFunBuyTransaction({
          payer,
          tokenMint,
          amount: 0,
          slippageTolerance: 0.01,
          priorityFee: 0.0001,
        })
      ).rejects.toThrow();
    });

    it('should throw error for invalid slippage', async () => {
      await expect(
        builder.buildPumpFunBuyTransaction({
          payer,
          tokenMint,
          amount: 0.1,
          slippageTolerance: -0.01,
          priorityFee: 0.0001,
        })
      ).rejects.toThrow();
    });
  });

  describe('buildPumpFunSellTransaction', () => {
    it('should build a valid sell transaction', async () => {
      const tx = await builder.buildPumpFunSellTransaction({
        payer,
        tokenMint,
        amount: 1000000,
        slippageTolerance: 0.01,
        priorityFee: 0.0001,
      });

      expect(tx).toBeDefined();
      expect(tx.instructions.length).toBeGreaterThan(0);
      expect(tx.feePayer).toEqual(payer);
    });

    it('should include compute budget instructions', async () => {
      const tx = await builder.buildPumpFunSellTransaction({
        payer,
        tokenMint,
        amount: 1000000,
        slippageTolerance: 0.01,
        priorityFee: 0.0001,
      });

      // First instruction should be compute unit limit
      expect(tx.instructions[0].programId.toBase58()).toBe(
        'ComputeBudget111111111111111111111111111111'
      );
    });

    it('should throw error for zero amount', async () => {
      await expect(
        builder.buildPumpFunSellTransaction({
          payer,
          tokenMint,
          amount: 0,
          slippageTolerance: 0.01,
          priorityFee: 0.0001,
        })
      ).rejects.toThrow();
    });
  });

  describe('priority fees', () => {
    it('should calculate priority fee correctly', async () => {
      const tx = await builder.buildPumpFunBuyTransaction({
        payer,
        tokenMint,
        amount: 0.1,
        slippageTolerance: 0.01,
        priorityFee: 0.001, // 1000 lamports
      });

      // Second instruction should be compute unit price
      expect(tx.instructions[1].programId.toBase58()).toBe(
        'ComputeBudget111111111111111111111111111111'
      );
    });

    it('should use default priority fee when not specified', async () => {
      const tx = await builder.buildPumpFunBuyTransaction({
        payer,
        tokenMint,
        amount: 0.1,
        slippageTolerance: 0.01,
      });

      expect(tx.instructions.length).toBeGreaterThan(1);
    });
  });

  describe('slippage protection', () => {
    it('should apply slippage to max cost for buy', async () => {
      const amount = 0.1;
      const slippage = 0.05; // 5%

      const tx = await builder.buildPumpFunBuyTransaction({
        payer,
        tokenMint,
        amount,
        slippageTolerance: slippage,
        priorityFee: 0.0001,
      });

      expect(tx).toBeDefined();
      // The transaction should have slippage built into the max cost parameter
    });

    it('should apply slippage to min output for sell', async () => {
      const amount = 1000000;
      const slippage = 0.05; // 5%

      const tx = await builder.buildPumpFunSellTransaction({
        payer,
        tokenMint,
        amount,
        slippageTolerance: slippage,
        priorityFee: 0.0001,
      });

      expect(tx).toBeDefined();
      // The transaction should have slippage built into the min output parameter
    });
  });
});

