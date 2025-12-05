/**
 * Transaction Sender
 * 
 * Sends transactions via Helius RPC with:
 * - Direct RPC sending
 * - Relayer pattern support
 * - Transaction simulation
 * - Retry with exponential backoff
 * - Confirmation tracking
 */

import {
  Transaction,
  VersionedTransaction,
  Keypair,
  Commitment,
} from '@solana/web3.js';
import { logger } from '@quantbot/utils';
import { HeliusRpcClient } from '../rpc/helius-rpc-client';
import type { TradeResult, SendOptions, SimulationResult } from '../types';

export interface TransactionSenderOptions {
  rpcClient: HeliusRpcClient;
  relayerUrl?: string;
  defaultCommitment?: Commitment;
  confirmationTimeout?: number;
  maxRetries?: number;
  retryDelay?: number;
}

/**
 * Transaction Sender with relayer support and retry logic
 */
export class TransactionSender {
  private readonly rpcClient: HeliusRpcClient;
  private readonly relayerUrl?: string;
  private readonly defaultCommitment: Commitment;
  private readonly confirmationTimeout: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;

  constructor(options: TransactionSenderOptions) {
    this.rpcClient = options.rpcClient;
    this.relayerUrl = options.relayerUrl || process.env.HELIUS_RELAYER_URL;
    this.defaultCommitment = options.defaultCommitment || 'confirmed';
    this.confirmationTimeout = options.confirmationTimeout || 30_000;
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000;
  }

  /**
   * Simulate a transaction before sending
   */
  async simulate(transaction: Transaction | VersionedTransaction): Promise<SimulationResult> {
    try {
      const commitment = this.defaultCommitment;
      const simulation = await this.rpcClient.simulateTransaction(transaction, commitment);

      return {
        success: !simulation.value.err,
        logs: simulation.value.logs || [],
        error: simulation.value.err ? JSON.stringify(simulation.value.err) : undefined,
        computeUnitsUsed: simulation.value.unitsConsumed,
      };
    } catch (error) {
      logger.error('Transaction simulation failed', error as Error);
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Send transaction with retry logic
   */
  async send(
    transaction: Transaction | VersionedTransaction,
    signers: Keypair[],
    options?: SendOptions
  ): Promise<TradeResult> {
    // Simulate first (unless skipPreflight is true)
    if (!options?.skipPreflight) {
      const simulation = await this.simulate(transaction);
      if (!simulation.success) {
        return {
          success: false,
          error: `Simulation failed: ${simulation.error}`,
        };
      }
    }

    // Sign the transaction
    if (transaction instanceof Transaction) {
      transaction.sign(...signers);
    } else if (transaction instanceof VersionedTransaction) {
      transaction.sign(signers);
    }

    // Send with retry
    let lastError: Error | null = null;
    let signature: string | undefined;

    for (let attempt = 0; attempt < (options?.maxRetries || this.maxRetries); attempt++) {
      try {
        const commitment = options?.commitment || this.defaultCommitment;
        signature = await this.rpcClient.sendTransaction(transaction, {
          skipPreflight: options?.skipPreflight ?? false,
          commitment,
          maxRetries: 1, // We handle retries ourselves
        });

        // Wait for confirmation
        const confirmed = await this.confirmTransaction(signature, commitment);
        if (confirmed) {
          return {
            success: true,
            transactionSignature: signature,
          };
        } else {
          throw new Error('Transaction confirmation timeout');
        }
      } catch (error) {
        lastError = error as Error;
        logger.warn(
          `Transaction send failed (attempt ${attempt + 1}/${this.maxRetries})`,
          error as Error
        );

        if (attempt < this.maxRetries - 1) {
          // Exponential backoff
          const delay = this.retryDelay * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    return {
      success: false,
      error: `Failed after ${this.maxRetries} attempts: ${lastError?.message || 'Unknown error'}`,
      transactionSignature: signature,
    };
  }

  /**
   * Send transaction via relayer
   */
  async sendViaRelayer(
    transaction: Transaction | VersionedTransaction,
    signers: Keypair[]
  ): Promise<TradeResult> {
    if (!this.relayerUrl) {
      throw new Error('Relayer URL not configured');
    }

    // Sign the transaction
    if (transaction instanceof Transaction) {
      transaction.sign(...signers);
    } else if (transaction instanceof VersionedTransaction) {
      transaction.sign(signers);
    }

    // Serialize transaction
    const serialized = transaction.serialize({
      requireAllSignatures: true,
      verifySignatures: false,
    });

    const base64Tx = Buffer.from(serialized).toString('base64');

    try {
      // Send to relayer
      const response = await fetch(this.relayerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transaction: base64Tx,
        }),
      });

      if (!response.ok) {
        throw new Error(`Relayer request failed: ${response.statusText}`);
      }

      const result: any = await response.json();
      const signature = result.signature || result.txid;

      if (!signature) {
        throw new Error('Relayer did not return transaction signature');
      }

      // Wait for confirmation
      const confirmed = await this.confirmTransaction(signature, this.defaultCommitment);
      if (confirmed) {
        return {
          success: true,
          transactionSignature: signature,
        };
      } else {
        return {
          success: false,
          error: 'Transaction confirmation timeout',
          transactionSignature: signature,
        };
      }
    } catch (error) {
      logger.error('Relayer send failed', error as Error);
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Confirm transaction with timeout
   */
  private async confirmTransaction(
    signature: string,
    commitment: Commitment
  ): Promise<boolean> {
    const startTime = Date.now();
    const timeout = this.confirmationTimeout;

    while (Date.now() - startTime < timeout) {
      try {
        const status = await this.rpcClient.getSignatureStatus(signature);
        
        if (status.value) {
          if (status.value.err) {
            logger.error('Transaction failed', {
              signature,
              error: status.value.err,
            });
            return false;
          }

          // Check if confirmed based on commitment level
          if (commitment === 'processed') {
            return true; // Processed is immediate
          }

          if (commitment === 'confirmed' && (status.value as any).confirmationStatus === 'confirmed') {
            return true;
          }

          if (commitment === 'finalized' && (status.value as any).confirmationStatus === 'finalized') {
            return true;
          }
        }

        // Wait a bit before checking again
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        logger.warn('Error checking transaction status', error as Error);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    logger.warn('Transaction confirmation timeout', { signature, timeout });
    return false;
  }
}

