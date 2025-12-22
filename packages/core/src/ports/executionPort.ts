/**
 * Execution Port
 *
 * Port interface for trade execution (Jito bundles, RPC send, etc.).
 * Adapters implement this port to provide execution capabilities.
 */

import type { TokenAddress, Chain } from '../index.js';

/**
 * Trade execution request
 */
export type ExecutionRequest = {
  tokenAddress: TokenAddress;
  chain: Chain;
  side: 'buy' | 'sell';
  amount: number; // Token amount or SOL amount depending on side
  slippageBps?: number; // Slippage in basis points (e.g., 100 = 1%)
  priorityFee?: number; // Priority fee in µLAM per compute unit
  maxRetries?: number;
};

/**
 * Trade execution result
 */
export type ExecutionResult = {
  success: boolean;
  txSignature?: string; // Transaction signature if successful
  error?: string; // Error message if failed
  executedPrice?: number; // Actual execution price
  executedAmount?: number; // Actual executed amount
  fees?: {
    networkFee: number; // Network fee in lamports
    priorityFee: number; // Priority fee in lamports
    totalFee: number; // Total fee in lamports
  };
};

/**
 * Execution Port Interface
 *
 * Handlers depend on this port, not on specific implementations (JitoClient, RPC client, etc.).
 * Adapters implement this port.
 */
export interface ExecutionPort {
  /**
   * Execute a trade
   */
  execute(request: ExecutionRequest): Promise<ExecutionResult>;

  /**
   * Check if execution is available (e.g., Jito available, RPC healthy)
   */
  isAvailable(): Promise<boolean>;
}

