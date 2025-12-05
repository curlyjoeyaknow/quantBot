/**
 * Wallet Service
 * 
 * Wallet operations, balance checking, and transaction signing
 */

import { PublicKey, Keypair } from '@solana/web3.js';
import { HeliusRpcClient } from '../rpc/helius-rpc-client';
import { WalletManager } from './wallet-manager';
import { logger } from '@quantbot/utils';
import type { Wallet } from '../types';

export interface WalletServiceOptions {
  walletManager: WalletManager;
  rpcClient: HeliusRpcClient;
}

/**
 * Wallet Service - wallet operations
 */
export class WalletService {
  private readonly walletManager: WalletManager;
  private readonly rpcClient: HeliusRpcClient;

  constructor(options: WalletServiceOptions) {
    this.walletManager = options.walletManager;
    this.rpcClient = options.rpcClient;
  }

  /**
   * Get wallet balance in SOL
   */
  async getBalance(walletId: number): Promise<number> {
    try {
      const wallet = await this.walletManager.getWallet(walletId);
      if (!wallet) {
        throw new Error(`Wallet ${walletId} not found`);
      }

      const publicKey = new PublicKey(wallet.publicKey);
      const balance = await this.rpcClient.getBalance(publicKey.toBase58());
      return balance / 1e9; // Convert lamports to SOL
    } catch (error) {
      logger.error('Failed to get wallet balance', error as Error, { walletId });
      throw error;
    }
  }

  /**
   * Get Keypair for signing transactions
   */
  async getKeypair(walletId: number): Promise<Keypair> {
    return this.walletManager.getKeypair(walletId);
  }

  /**
   * Get wallet by ID
   */
  async getWallet(walletId: number): Promise<Wallet | null> {
    return this.walletManager.getWallet(walletId);
  }

  /**
   * Get active wallet for user
   */
  async getActiveWallet(userId: number, walletId?: number): Promise<Wallet | null> {
    return this.walletManager.getActiveWallet(userId, walletId);
  }

  /**
   * Get all wallets for user
   */
  async getUserWallets(userId: number): Promise<Wallet[]> {
    return this.walletManager.getUserWallets(userId);
  }
}

