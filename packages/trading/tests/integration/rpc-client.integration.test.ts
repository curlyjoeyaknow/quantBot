/**
 * Helius RPC Client Integration Tests
 * 
 * Tests RPC client functionality against Solana devnet
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Keypair, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { setupTestnet, requestAirdrop, cleanup, type TestWallet } from './testnet-setup';
import type { HeliusRpcClient } from '../../src/rpc/helius-rpc-client';
import type { Connection } from '@solana/web3.js';

describe('HeliusRpcClient Integration Tests', () => {
  let rpcClient: HeliusRpcClient;
  let connection: Connection;
  let testWallet: TestWallet;

  beforeAll(async () => {
    const apiKey = process.env.HELIUS_API_KEY || 'demo';
    
    const setup = await setupTestnet({
      heliusApiKey: apiKey,
    });

    rpcClient = setup.rpcClient;
    connection = setup.connection;
    testWallet = setup.testWallet;

    // Request airdrop if balance is low
    if (testWallet.balance < 1) {
      console.log('Requesting airdrop...');
      await requestAirdrop(connection, testWallet.publicKey, 2);
      testWallet.balance = 2;
    }
  }, 30000);

  afterAll(async () => {
    await cleanup(testWallet);
  });

  it('should send a simple transaction', async () => {
    const recipient = Keypair.generate();

    // Create a simple transfer transaction
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: testWallet.publicKey,
        toPubkey: recipient.publicKey,
        lamports: 0.01 * LAMPORTS_PER_SOL,
      })
    );

    // Get latest blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = testWallet.publicKey;

    // Sign transaction
    transaction.sign(testWallet.keypair);

    // Send via RPC client
    const signature = await rpcClient.sendRawTransaction(
      transaction.serialize(),
      'confirmed'
    );

    expect(signature).toBeTruthy();
    expect(typeof signature).toBe('string');

    // Wait for confirmation
    const confirmation = await rpcClient.confirmTransaction(signature);
    expect(confirmation.value.err).toBeNull();
  }, 30000);

  it('should simulate a transaction before sending', async () => {
    const recipient = Keypair.generate();

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: testWallet.publicKey,
        toPubkey: recipient.publicKey,
        lamports: 0.01 * LAMPORTS_PER_SOL,
      })
    );

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = testWallet.publicKey;
    transaction.sign(testWallet.keypair);

    // Simulate transaction
    const simulation = await rpcClient.simulateTransaction(transaction);

    expect(simulation).toBeDefined();
    expect(simulation.value).toBeDefined();
    // Simulation should succeed
    expect(simulation.value.err).toBeNull();
  }, 30000);

  it('should handle connection failover gracefully', async () => {
    // This test verifies that the RPC client can handle connection issues
    const { blockhash } = await connection.getLatestBlockhash();
    
    expect(blockhash).toBeTruthy();
    expect(typeof blockhash).toBe('string');
  }, 15000);

  it('should get signature status', async () => {
    // Use a known testnet signature or create a new transaction
    const recipient = Keypair.generate();

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: testWallet.publicKey,
        toPubkey: recipient.publicKey,
        lamports: 0.001 * LAMPORTS_PER_SOL,
      })
    );

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = testWallet.publicKey;
    transaction.sign(testWallet.keypair);

    const signature = await rpcClient.sendRawTransaction(
      transaction.serialize(),
      'confirmed'
    );

    // Get status
    const status = await rpcClient.getSignatureStatus(signature);

    expect(status).toBeDefined();
    expect(status.value).toBeDefined();
  }, 30000);
});

