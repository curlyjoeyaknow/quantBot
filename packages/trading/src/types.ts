/**
 * Core types for the trading package
 */

import { PublicKey, Transaction, Keypair } from '@solana/web3.js';
import type { Strategy, StopLossConfig } from '@quantbot/core';

/**
 * Trading configuration for a user
 */
export interface TradingConfig {
  userId: number;
  enabled: boolean;
  maxPositionSize: number; // Maximum SOL per position
  maxTotalExposure: number; // Maximum total SOL across all positions
  slippageTolerance: number; // Percentage (e.g., 0.01 for 1%)
  dailyLossLimit: number; // Maximum daily loss in SOL
  alertRules: AlertTradeRules;
  dryRun: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Rules for when to execute trades from alerts
 */
export interface AlertTradeRules {
  caDropAlerts: boolean;
  ichimokuSignals: boolean;
  liveTradeEntry: boolean;
  minConfidence?: number; // Minimum confidence score to execute
  callerWhitelist?: string[]; // Only execute trades from these callers
  callerBlacklist?: string[]; // Never execute trades from these callers
}

/**
 * Trade order generated from strategy
 */
export interface TradeOrder {
  type: 'buy' | 'sell';
  tokenMint: string;
  chain: string;
  amount: number; // Amount in SOL (for buy) or token amount (for sell)
  expectedPrice: number;
  slippageTolerance: number;
  strategyId?: number;
  alertId?: number;
  takeProfitTarget?: number; // For sell orders
  stopLossPrice?: number; // For sell orders
}

/**
 * Result of trade execution
 */
export interface TradeResult {
  success: boolean;
  transactionSignature?: string;
  executedPrice?: number;
  executedAmount?: number;
  slippage?: number;
  error?: string;
  positionId?: number;
}

/**
 * Position in the database
 */
export interface Position {
  id: number;
  userId: number;
  walletId: number;
  tokenMint: string;
  chain: string;
  entryPrice: number;
  entryTime: Date;
  positionSize: number; // Amount in SOL
  remainingSize: number; // Remaining position size
  status: 'open' | 'closed' | 'partial';
  strategyId?: number;
  alertId?: number;
  stopLossPrice?: number;
  takeProfitTargets?: TakeProfitTarget[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Take profit target for a position
 */
export interface TakeProfitTarget {
  target: number; // Multiplier (e.g., 2.0 for 2x)
  percent: number; // Percentage of position to close (e.g., 0.5 for 50%)
  executed: boolean;
  executedAt?: Date;
}

/**
 * Position event (entry, exit, partial close)
 */
export interface PositionEvent {
  id: number;
  positionId: number;
  eventType: 'entry' | 'exit' | 'partial_close' | 'stop_loss' | 'take_profit';
  price: number;
  size: number; // Amount in SOL
  timestamp: Date;
  transactionSignature?: string;
}

/**
 * Trade record in database
 */
export interface Trade {
  id: number;
  userId: number;
  positionId?: number;
  type: 'buy' | 'sell';
  tokenMint: string;
  chain: string;
  price: number;
  size: number;
  slippage?: number;
  transactionSignature?: string;
  status: 'pending' | 'confirmed' | 'failed';
  errorMessage?: string;
  timestamp: Date;
}

/**
 * Wallet record
 */
export interface Wallet {
  id: number;
  userId: number;
  publicKey: string;
  encryptedPrivateKey: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
}

/**
 * Parameters for opening a position
 */
export interface OpenPositionParams {
  userId: number;
  walletId: number;
  tokenMint: string;
  chain: string;
  entryPrice: number;
  positionSize: number;
  strategyId?: number;
  alertId?: number;
  stopLossConfig?: StopLossConfig;
  takeProfitTargets?: TakeProfitTarget[];
}

/**
 * Parameters for Pump.fun buy transaction
 */
export interface PumpfunBuyParams {
  payer: PublicKey;
  tokenMint: PublicKey;
  creator: PublicKey;
  solAmount: number; // Amount in SOL (lamports)
  maxSolCost: number; // Maximum SOL cost with slippage
  tokenProgram?: PublicKey; // Legacy or Token-2022
}

/**
 * Parameters for Pump.fun sell transaction
 */
export interface PumpfunSellParams {
  payer: PublicKey;
  tokenMint: PublicKey;
  creator: PublicKey;
  tokenAmount: number; // Amount of tokens to sell
  minSolOutput: number; // Minimum SOL output with slippage
  tokenProgram?: PublicKey;
}

/**
 * Parameters for DEX swap
 */
export interface DexSwapParams {
  payer: PublicKey;
  inputMint: PublicKey;
  outputMint: PublicKey;
  amount: number;
  slippageBps: number; // Basis points (e.g., 50 for 0.5%)
  dex: 'jupiter' | 'raydium' | 'orca' | 'meteora';
}

/**
 * Options for sending transactions
 */
export interface SendOptions {
  skipPreflight?: boolean;
  commitment?: 'processed' | 'confirmed' | 'finalized';
  maxRetries?: number;
  retryDelay?: number;
}

/**
 * Simulation result
 */
export interface SimulationResult {
  success: boolean;
  logs?: string[];
  error?: string;
  computeUnitsUsed?: number;
}

