/**
 * Testnet Integration Test Setup
 * 
 * Utilities for setting up testnet integration tests
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { HeliusRpcClient } from '../../src/rpc/helius-rpc-client';

export interface TestnetConfig {
  heliusApiKey: string;
  testWalletPrivateKey?: string;
  rpcEndpoint?: string;
}

export interface TestWallet {
  keypair: Keypair;
  publicKey: PublicKey;
  balance: number;
}

/**
 * Setup testnet environment
 */
export async function setupTestnet(config: TestnetConfig): Promise<{
  rpcClient: HeliusRpcClient;
  connection: Connection;
  testWallet: TestWallet;
}> {
  // Initialize RPC client (use devnet for tests)
  const rpcClient = new HeliusRpcClient({
    apiKey: config.heliusApiKey,
    region: 'mainnet', // Helius doesn't have devnet-specific regions
  });

  // Create connection to devnet
  const connection = new Connection(
    config.rpcEndpoint || 'https://api.devnet.solana.com',
    'confirmed'
  );

  // Create or load test wallet
  let keypair: Keypair;
  if (config.testWalletPrivateKey) {
    const secretKey = Uint8Array.from(JSON.parse(config.testWalletPrivateKey));
    keypair = Keypair.fromSecretKey(secretKey);
  } else {
    keypair = Keypair.generate();
  }

  // Get balance
  const balance = await connection.getBalance(keypair.publicKey);

  const testWallet: TestWallet = {
    keypair,
    publicKey: keypair.publicKey,
    balance: balance / LAMPORTS_PER_SOL,
  };

  return {
    rpcClient,
    connection,
    testWallet,
  };
}

/**
 * Request airdrop on devnet
 */
export async function requestAirdrop(
  connection: Connection,
  publicKey: PublicKey,
  amount: number = 2
): Promise<string> {
  const signature = await connection.requestAirdrop(
    publicKey,
    amount * LAMPORTS_PER_SOL
  );

  await connection.confirmTransaction(signature);
  return signature;
}

/**
 * Wait for balance to update
 */
export async function waitForBalance(
  connection: Connection,
  publicKey: PublicKey,
  expectedMinBalance: number,
  maxAttempts: number = 10
): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const balance = await connection.getBalance(publicKey);
    const balanceSol = balance / LAMPORTS_PER_SOL;

    if (balanceSol >= expectedMinBalance) {
      return balanceSol;
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  throw new Error(`Balance did not reach ${expectedMinBalance} SOL after ${maxAttempts} attempts`);
}

/**
 * Clean up test data
 */
export async function cleanup(testWallet: TestWallet): Promise<void> {
  // In a real implementation, you might want to:
  // - Close open positions
  // - Return test SOL to faucet
  // - Clean up database records
  console.log(`Test wallet cleanup: ${testWallet.publicKey.toBase58()}`);
}

