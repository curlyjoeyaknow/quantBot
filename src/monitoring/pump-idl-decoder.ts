/**
 * Pump.fun IDL Decoder
 * Decodes Pump.fun bonding curve account data using Anchor's BorshAccountsCoder
 * Based on Shyft examples: https://github.com/Shyft-to/solana-defi
 */

import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { BorshAccountsCoder } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';

// Pump.fun program ID
export const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

// Load IDL
const IDL_PATH = path.join(__dirname, '../../examples/solana-defi/PumpFun/Typescript/stream_pump_fun_bonding_curve_progress_accounts/Idl/pump_0.1.0.json');
let accountCoder: BorshAccountsCoder | null = null;

function getAccountCoder(): BorshAccountsCoder {
  if (!accountCoder) {
    try {
      const programIdl = JSON.parse(fs.readFileSync(IDL_PATH, 'utf8'));
      accountCoder = new BorshAccountsCoder(programIdl);
    } catch (error) {
      // Fallback: try to load from examples directory relative to project root
      const fallbackPath = path.join(process.cwd(), 'examples/solana-defi/PumpFun/Typescript/stream_pump_fun_bonding_curve_progress_accounts/Idl/pump_0.1.0.json');
      try {
        const programIdl = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
        accountCoder = new BorshAccountsCoder(programIdl);
      } catch (fallbackError) {
        throw new Error(`Failed to load Pump.fun IDL from ${IDL_PATH} or ${fallbackPath}: ${error}`);
      }
    }
  }
  return accountCoder;
}

/**
 * BondingCurve account structure (decoded by Anchor)
 * Uses snake_case naming as per Rust/IDL convention
 */
export interface BondingCurveAccount {
  virtual_token_reserves: BN | string;
  virtual_sol_reserves: BN | string;
  real_token_reserves: BN | string;
  real_sol_reserves: BN | string;
  token_total_supply: BN | string;
  complete: boolean;
  creator: PublicKey | string;
  // Additional fields that may exist in some accounts
  mint?: PublicKey | string;
  sol_reserves?: BN | string;
  token_reserves?: BN | string;
  buy_royalty_percentage?: number;
  sell_royalty_percentage?: number;
  created_at?: BN | string;
  [key: string]: any; // Allow for additional fields
}

/**
 * Decode bonding curve account using Anchor's BorshAccountsCoder
 * @param data - Account data as Buffer, Uint8Array, or base64 string
 * @returns Decoded BondingCurve account or null if invalid
 */
export function decodeBondingCurveAccount(data: Buffer | Uint8Array | string): BondingCurveAccount | null {
  try {
    const coder = getAccountCoder();
    
    // Convert input to Buffer
    let buffer: Buffer;
    if (Buffer.isBuffer(data)) {
      buffer = data;
    } else if (data instanceof Uint8Array) {
      buffer = Buffer.from(data);
    } else if (typeof data === 'string') {
      // Assume base64
      buffer = Buffer.from(data, 'base64');
    } else {
      return null;
    }

    // Check discriminator first
    const expectedDiscriminator = coder.accountDiscriminator('BondingCurve');
    const actualDiscriminator = buffer.slice(0, 8);
    
    if (!expectedDiscriminator.equals(actualDiscriminator)) {
      return null; // Not a BondingCurve account
    }

    // Decode using Anchor
    const decoded = coder.decode('BondingCurve', buffer);
    
    if (!decoded) {
      return null;
    }

    // Return decoded account (Anchor handles all the parsing)
    return decoded as BondingCurveAccount;
  } catch (error: any) {
    // Silently fail - not a BondingCurve account or invalid data
    return null;
  }
}

/**
 * Derive mint address from bonding curve PDA address
 * Note: This requires a reverse lookup since PDAs can't be reversed directly.
 * We maintain a cache or can fetch from associated token account.
 * 
 * @param bondingCurveAddress - The bonding curve PDA address
 * @returns The mint address if found, or null
 */
export function deriveMintFromBondingCurve(bondingCurveAddress: string): string | null {
  // Unfortunately, PDAs can't be reversed directly
  // We need to maintain a mapping or fetch from associated token account
  // For now, return null - caller should maintain their own mapping
  return null;
}

/**
 * Calculate price from decoded bonding curve account
 * Uses the bonding curve formula: price = sol_reserves / token_reserves
 * For Pump.fun: price = real_sol_reserves / real_token_reserves
 */
export function calculatePriceFromBondingCurve(account: BondingCurveAccount, solPriceUsd: number = 150): number {
  // Get reserves - prefer real_reserves, fallback to virtual_reserves
  const solReserves = account.real_sol_reserves || account.virtual_sol_reserves || account.sol_reserves;
  const tokenReserves = account.real_token_reserves || account.virtual_token_reserves || account.token_reserves;
  
  if (!solReserves || !tokenReserves) {
    return 0;
  }

  // Convert to string then to number/BigInt
  const solStr = typeof solReserves === 'string' ? solReserves : (solReserves as BN).toString();
  const tokenStr = typeof tokenReserves === 'string' ? tokenReserves : (tokenReserves as BN).toString();
  
  // Handle hex strings (from Anchor decoder)
  const solValue = solStr.startsWith('0x') ? BigInt(solStr) : BigInt('0x' + solStr);
  const tokenValue = tokenStr.startsWith('0x') ? BigInt(tokenStr) : BigInt('0x' + tokenStr);
  
  if (tokenValue === 0n) {
    return 0;
  }

  // Calculate price in SOL per token (using real reserves)
  // Price = sol_reserves / token_reserves
  const priceInSol = Number(solValue) / Number(tokenValue);
  
  // Convert to USD
  return priceInSol * solPriceUsd;
}
