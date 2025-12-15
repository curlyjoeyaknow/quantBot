/**
 * Pump.fun IDL Decoder
 * Decodes Pump.fun bonding curve account data using Anchor's BorshAccountsCoder
 * Based on Shyft examples: https://github.com/Shyft-to/solana-defi
 */
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
export declare const PUMP_PROGRAM_ID: PublicKey;
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
  mint?: PublicKey | string;
  sol_reserves?: BN | string;
  token_reserves?: BN | string;
  buy_royalty_percentage?: number;
  sell_royalty_percentage?: number;
  created_at?: BN | string;
  [key: string]: any;
}
/**
 * Decode bonding curve account using Anchor's BorshAccountsCoder
 * @param data - Account data as Buffer, Uint8Array, or base64 string
 * @returns Decoded BondingCurve account or null if invalid
 */
export declare function decodeBondingCurveAccount(
  data: Buffer | Uint8Array | string
): BondingCurveAccount | null;
/**
 * Derive mint address from bonding curve PDA address
 * Note: This requires a reverse lookup since PDAs can't be reversed directly.
 * We maintain a cache or can fetch from associated token account.
 *
 * @param bondingCurveAddress - The bonding curve PDA address
 * @returns The mint address if found, or null
 */
export declare function deriveMintFromBondingCurve(bondingCurveAddress: string): string | null;
/**
 * Calculate price from decoded bonding curve account
 * Uses the bonding curve formula: price = sol_reserves / token_reserves
 * For Pump.fun: price = real_sol_reserves / real_token_reserves
 */
export declare function calculatePriceFromBondingCurve(
  account: BondingCurveAccount,
  solPriceUsd?: number
): number;
//# sourceMappingURL=pump-idl-decoder.d.ts.map
