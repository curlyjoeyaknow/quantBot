/**
 * DEX Transaction Parser
 * Parses transactions from Raydium, Orca, Meteora to extract prices and mints
 * Based on Shyft examples: https://github.com/Shyft-to/solana-defi
 */

import { PublicKey, VersionedTransactionResponse } from '@solana/web3.js';
import { Idl } from '@coral-xyz/anchor';

// Transaction formatter (from examples)
class TransactionFormatter {
  public formTransactionFromJson(data: any, time: number): VersionedTransactionResponse {
    const rawTx = data['transaction'] || data;
    const slot = data.slot || rawTx.slot;
    const version = rawTx.transaction?.message?.versioned ? 0 : 'legacy';

    const meta = this.formMeta(rawTx.meta || rawTx.transaction?.meta);
    
    // Handle signatures - could be base64 Buffer or already encoded string
    let signatures: string[] = [];
    if (rawTx.transaction?.signatures) {
      signatures = rawTx.transaction.signatures.map((s: any) => {
        if (typeof s === 'string') return s;
        if (Buffer.isBuffer(s)) {
          try {
            const bs58 = require('bs58');
            return bs58.encode(s);
          } catch {
            return s.toString('base64');
          }
        }
        return String(s);
      });
    }

    const message = this.formTxnMessage(rawTx.transaction?.message || rawTx.message);

    return {
      slot: slot || 0,
      version: version as any,
      blockTime: time,
      meta,
      transaction: {
        signatures,
        message,
      },
    };
  }

  private formTxnMessage(message: any): any {
    // Simplified - full implementation in examples
    return message;
  }

  private formMeta(meta: any): any {
    return {
      err: meta.errorInfo ? { err: meta.errorInfo } : null,
      fee: meta.fee,
      preBalances: meta.preBalances,
      postBalances: meta.postBalances,
      preTokenBalances: meta.preTokenBalances || [],
      postTokenBalances: meta.postTokenBalances || [],
      logMessages: meta.logMessages || [],
      loadedAddresses: meta.loadedWritableAddresses || meta.loadedReadonlyAddresses
        ? {
            writable: meta.loadedWritableAddresses?.map((address: string) =>
              new PublicKey(Buffer.from(address, 'base64'))
            ) || [],
            readonly: meta.loadedReadonlyAddresses?.map((address: string) =>
              new PublicKey(Buffer.from(address, 'base64'))
            ) || [],
          }
        : undefined,
      innerInstructions: meta.innerInstructions || [],
    };
  }
}

export interface SwapEvent {
  type: 'Buy' | 'Sell';
  mint: string;
  amountIn: number | string;
  amountOut: number | string;
  price?: number;
  user?: string;
}

export class DexTransactionParser {
  private transactionFormatter: TransactionFormatter;
  
  // Program IDs
  private readonly PUMP_FUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
  private readonly RAYDIUM_AMM_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
  private readonly ORCA_WHIRLPOOL_PROGRAM_ID = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';
  private readonly METEORA_DBC_PROGRAM_ID = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';
  
  private readonly SOL_MINT = 'So11111111111111111111111111111111111111112';
  private readonly USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

  constructor() {
    this.transactionFormatter = new TransactionFormatter();
  }

  /**
   * Parse transaction and extract swap events
   */
  public parseTransaction(data: any): SwapEvent | null {
    try {
      if (!data.transaction) return null;

      const txn = this.transactionFormatter.formTransactionFromJson(data.transaction, Date.now());
      
      // Check which DEX this transaction belongs to
      const programIds = this.getProgramIds(txn);
      
      if (programIds.includes(this.PUMP_FUN_PROGRAM_ID)) {
        return this.parsePumpFunTransaction(txn);
      } else if (programIds.includes(this.RAYDIUM_AMM_PROGRAM_ID)) {
        return this.parseRaydiumTransaction(txn);
      } else if (programIds.includes(this.ORCA_WHIRLPOOL_PROGRAM_ID)) {
        return this.parseOrcaTransaction(txn);
      } else if (programIds.includes(this.METEORA_DBC_PROGRAM_ID)) {
        return this.parseMeteoraTransaction(txn);
      }

      return null;
    } catch (error) {
      // Silently fail - transaction parsing is best-effort
      return null;
    }
  }

  /**
   * Extract mint from Pump.fun token creation transaction
   */
  public extractMintFromPumpFunCreation(data: any): string | null {
    try {
      if (!data.transaction) return null;
      
      const txn = this.transactionFormatter.formTransactionFromJson(data.transaction, Date.now());
      
      // Check if this is a Pump.fun transaction
      const programIds = this.getProgramIds(txn);
      if (!programIds.includes(this.PUMP_FUN_PROGRAM_ID)) return null;
      
      // Extract mint from post token balances
      if (txn.meta?.postTokenBalances) {
        for (const balance of txn.meta.postTokenBalances) {
          if (balance.mint && balance.mint !== this.SOL_MINT && balance.mint !== this.USDC_MINT) {
            return balance.mint;
          }
        }
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  private getProgramIds(txn: VersionedTransactionResponse): string[] {
    const programIds: string[] = [];
    
    if (txn.transaction?.message) {
      const accountKeys = txn.transaction.message.getAccountKeys();
      const keys = accountKeys.keySegments().flat();
      for (const key of keys) {
        if (key instanceof PublicKey) {
          programIds.push(key.toBase58());
        } else if (typeof key === 'string') {
          programIds.push(key);
        }
      }
    }
    
    return programIds;
  }

  private parsePumpFunTransaction(txn: VersionedTransactionResponse): SwapEvent | null {
    // Pump.fun swaps are handled via bonding curve account updates
    // This is mainly for token creation events
    return null;
  }

  private parseRaydiumTransaction(txn: VersionedTransactionResponse): SwapEvent | null {
    try {
      // Extract from token balances (simplified approach)
      const preBalances = txn.meta?.preTokenBalances || [];
      const postBalances = txn.meta?.postTokenBalances || [];
      
      // Find token mint (not SOL/USDC)
      const tokenMint = preBalances.find(
        (b: any) => b.mint !== this.SOL_MINT && b.mint !== this.USDC_MINT
      )?.mint;
      
      if (!tokenMint) return null;
      
      // Find SOL balance changes to determine buy/sell
      const solPre = preBalances.find((b: any) => b.mint === this.SOL_MINT)?.uiTokenAmount?.uiAmount || 0;
      const solPost = postBalances.find((b: any) => b.SOL_MINT)?.uiTokenAmount?.uiAmount || 0;
      
      const type: 'Buy' | 'Sell' = solPre > solPost ? 'Buy' : 'Sell';
      
      // Extract amounts (simplified - full parsing requires IDL)
      const tokenPre = preBalances.find((b: any) => b.mint === tokenMint)?.uiTokenAmount?.uiAmount || 0;
      const tokenPost = postBalances.find((b: any) => b.mint === tokenMint)?.uiTokenAmount?.uiAmount || 0;
      
      const amountIn = type === 'Buy' ? Math.abs(solPre - solPost) : Math.abs(tokenPre - tokenPost);
      const amountOut = type === 'Buy' ? Math.abs(tokenPost - tokenPre) : Math.abs(solPost - solPre);
      
      return {
        type,
        mint: tokenMint,
        amountIn: amountIn.toString(),
        amountOut: amountOut.toString(),
      };
    } catch (error) {
      return null;
    }
  }

  private parseOrcaTransaction(txn: VersionedTransactionResponse): SwapEvent | null {
    try {
      // Similar to Raydium - extract from token balances
      const preBalances = txn.meta?.preTokenBalances || [];
      const postBalances = txn.meta?.postTokenBalances || [];
      
      const tokenMint = preBalances.find(
        (b: any) => b.mint !== this.SOL_MINT && b.mint !== this.USDC_MINT
      )?.mint;
      
      if (!tokenMint) return null;
      
      const solPre = preBalances.find((b: any) => b.mint === this.SOL_MINT)?.uiTokenAmount?.uiAmount || 0;
      const solPost = postBalances.find((b: any) => b.mint === this.SOL_MINT)?.uiTokenAmount?.uiAmount || 0;
      
      const type: 'Buy' | 'Sell' = solPre > solPost ? 'Buy' : 'Sell';
      
      const tokenPre = preBalances.find((b: any) => b.mint === tokenMint)?.uiTokenAmount?.uiAmount || 0;
      const tokenPost = postBalances.find((b: any) => b.mint === tokenMint)?.uiTokenAmount?.uiAmount || 0;
      
      const amountIn = type === 'Buy' ? Math.abs(solPre - solPost) : Math.abs(tokenPre - tokenPost);
      const amountOut = type === 'Buy' ? Math.abs(tokenPost - tokenPre) : Math.abs(solPost - solPre);
      
      return {
        type,
        mint: tokenMint,
        amountIn: amountIn.toString(),
        amountOut: amountOut.toString(),
      };
    } catch (error) {
      return null;
    }
  }

  private parseMeteoraTransaction(txn: VersionedTransactionResponse): SwapEvent | null {
    try {
      // Similar approach for Meteora
      const preBalances = txn.meta?.preTokenBalances || [];
      const postBalances = txn.meta?.postTokenBalances || [];
      
      const tokenMint = preBalances.find(
        (b: any) => b.mint !== this.SOL_MINT && b.mint !== this.USDC_MINT
      )?.mint;
      
      if (!tokenMint) return null;
      
      const solPre = preBalances.find((b: any) => b.mint === this.SOL_MINT)?.uiTokenAmount?.uiAmount || 0;
      const solPost = postBalances.find((b: any) => b.mint === this.SOL_MINT)?.uiTokenAmount?.uiAmount || 0;
      
      const type: 'Buy' | 'Sell' = solPre > solPost ? 'Buy' : 'Sell';
      
      const tokenPre = preBalances.find((b: any) => b.mint === tokenMint)?.uiTokenAmount?.uiAmount || 0;
      const tokenPost = postBalances.find((b: any) => b.mint === tokenMint)?.uiTokenAmount?.uiAmount || 0;
      
      const amountIn = type === 'Buy' ? Math.abs(solPre - solPost) : Math.abs(tokenPre - tokenPost);
      const amountOut = type === 'Buy' ? Math.abs(tokenPost - tokenPre) : Math.abs(solPost - solPre);
      
      return {
        type,
        mint: tokenMint,
        amountIn: amountIn.toString(),
        amountOut: amountOut.toString(),
      };
    } catch (error) {
      return null;
    }
  }
}

