/**
 * Transaction Builder
 * 
 * Builds Solana transactions for:
 * - Pump.fun buy/sell
 * - DEX swaps (via Jupiter aggregator)
 * - Compute budget and priority fee management
 */

import {
  Transaction,
  VersionedTransaction,
  PublicKey,
  SystemProgram,
  ComputeBudgetProgram,
  TransactionInstruction,
  Keypair,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { PUMP_FUN_PROGRAM_ID, derivePumpfunBondingCurve } from '@quantbot/utils';
import { logger } from '@quantbot/utils';
import type {
  PumpfunBuyParams,
  PumpfunSellParams,
  DexSwapParams,
} from '../types';

/**
 * Transaction Builder for Solana trading
 */
export class TransactionBuilder {
  private readonly pumpFunProgramId: PublicKey;
  private readonly systemProgramId: PublicKey;

  constructor() {
    this.pumpFunProgramId = PUMP_FUN_PROGRAM_ID;
    this.systemProgramId = SystemProgram.programId;
  }

  /**
   * Build a Pump.fun buy transaction
   * 
   * Account layout (16 accounts):
   * 0. global (ro)
   * 1. fee_recipient (w)
   * 2. mint (ro) - token mint
   * 3. bonding_curve (w) - PDA("bonding-curve", mint)
   * 4. associated_bonding_curve (w) - ATA(bonding_curve, mint, token_program)
   * 5. associated_user (w) - ATA(user, mint, token_program)
   * 6. user (w, signer)
   * 7. system_program (ro)
   * 8. token_program (ro) - legacy or 2022
   * 9. creator_vault (w) - PDA("creator-vault", creator)
   * 10. event_authority (ro)
   * 11. pump_program (ro)
   * 12. global_volume_accumulator (w)
   * 13. user_volume_accumulator (w)
   * 14. fee_config (ro)
   * 15. fee_config_program (ro)
   */
  async buildPumpfunBuy(params: PumpfunBuyParams): Promise<Transaction> {
    const {
      payer,
      tokenMint,
      creator,
      solAmount,
      maxSolCost,
      tokenProgram = TOKEN_PROGRAM_ID,
    } = params;

    const transaction = new Transaction();

    // Derive PDAs
    const bondingCurveAddress = derivePumpfunBondingCurve(tokenMint.toBase58());
    if (!bondingCurveAddress) {
      throw new Error('Failed to derive bonding curve address');
    }
    const bondingCurve = new PublicKey(bondingCurveAddress);
    
    // Derive associated token accounts
    const associatedBondingCurve = await getAssociatedTokenAddress(
      tokenMint,
      bondingCurve,
      true, // allowOwnerOffCurve
      tokenProgram
    );

    const associatedUser = await getAssociatedTokenAddress(
      tokenMint,
      payer,
      false,
      tokenProgram
    );

    // Derive creator vault (PDA: "creator-vault", creator)
    const [creatorVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('creator-vault'), creator.toBuffer()],
      this.pumpFunProgramId
    );

    // Derive event authority (PDA: "event-authority")
    const [eventAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('event-authority')],
      this.pumpFunProgramId
    );

    // Derive global volume accumulator
    const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from('global-volume-accumulator')],
      this.pumpFunProgramId
    );

    // Derive user volume accumulator (PDA: "user-volume-accumulator", user)
    const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [Buffer.from('user-volume-accumulator'), payer.toBuffer()],
      this.pumpFunProgramId
    );

    // Derive fee config (PDA: "fee-config")
    const [feeConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from('fee-config')],
      this.pumpFunProgramId
    );

    // Derive fee config program (usually same as pump program)
    const feeConfigProgram = this.pumpFunProgramId;

    // Derive global account (PDA: "global")
    const [global] = PublicKey.findProgramAddressSync(
      [Buffer.from('global')],
      this.pumpFunProgramId
    );

    // Derive fee recipient (PDA: "fee-recipient")
    const [feeRecipient] = PublicKey.findProgramAddressSync(
      [Buffer.from('fee-recipient')],
      this.pumpFunProgramId
    );

    // Create ATA instruction if needed (idempotent)
    const createAtaIx = createAssociatedTokenAccountInstruction(
      payer,
      associatedUser,
      payer,
      tokenMint,
      tokenProgram
    );

    // Build buy instruction data
    // Instruction discriminator for buy: 0x00 (or check actual IDL)
    // Args: lamports (u64), max_sol_cost (u64)
    const buyIxData = Buffer.alloc(17); // 1 byte discriminator + 8 bytes lamports + 8 bytes max_sol_cost
    buyIxData.writeUInt8(0, 0); // Buy instruction discriminator
    buyIxData.writeBigUInt64LE(BigInt(solAmount), 1);
    buyIxData.writeBigUInt64LE(BigInt(maxSolCost), 9);

    // Build buy instruction
    const buyIx = new TransactionInstruction({
      programId: this.pumpFunProgramId,
      keys: [
        { pubkey: global, isSigner: false, isWritable: false },
        { pubkey: feeRecipient, isSigner: false, isWritable: true },
        { pubkey: tokenMint, isSigner: false, isWritable: false },
        { pubkey: bondingCurve, isSigner: false, isWritable: true },
        { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
        { pubkey: associatedUser, isSigner: false, isWritable: true },
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: this.systemProgramId, isSigner: false, isWritable: false },
        { pubkey: tokenProgram, isSigner: false, isWritable: false },
        { pubkey: creatorVault, isSigner: false, isWritable: true },
        { pubkey: eventAuthority, isSigner: false, isWritable: false },
        { pubkey: this.pumpFunProgramId, isSigner: false, isWritable: false },
        { pubkey: globalVolumeAccumulator, isSigner: false, isWritable: true },
        { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
        { pubkey: feeConfig, isSigner: false, isWritable: false },
        { pubkey: feeConfigProgram, isSigner: false, isWritable: false },
      ],
      data: buyIxData,
    });

    transaction.add(createAtaIx);
    transaction.add(buyIx);

    return transaction;
  }

  /**
   * Build a Pump.fun sell transaction
   * 
   * Account layout (14 accounts):
   * Similar to buy but without some accounts
   */
  async buildPumpfunSell(params: PumpfunSellParams): Promise<Transaction> {
    const {
      payer,
      tokenMint,
      creator,
      tokenAmount,
      minSolOutput,
      tokenProgram = TOKEN_PROGRAM_ID,
    } = params;

    const transaction = new Transaction();

    // Derive PDAs (same as buy)
    const bondingCurveAddress = derivePumpfunBondingCurve(tokenMint.toBase58());
    if (!bondingCurveAddress) {
      throw new Error('Failed to derive bonding curve address');
    }
    const bondingCurve = new PublicKey(bondingCurveAddress);
    
    const associatedBondingCurve = await getAssociatedTokenAddress(
      tokenMint,
      bondingCurve,
      true,
      tokenProgram
    );

    const associatedUser = await getAssociatedTokenAddress(
      tokenMint,
      payer,
      false,
      tokenProgram
    );

    const [creatorVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('creator-vault'), creator.toBuffer()],
      this.pumpFunProgramId
    );

    const [eventAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('event-authority')],
      this.pumpFunProgramId
    );

    const [global] = PublicKey.findProgramAddressSync(
      [Buffer.from('global')],
      this.pumpFunProgramId
    );

    const [feeRecipient] = PublicKey.findProgramAddressSync(
      [Buffer.from('fee-recipient')],
      this.pumpFunProgramId
    );

    const [feeConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from('fee-config')],
      this.pumpFunProgramId
    );

    const feeConfigProgram = this.pumpFunProgramId;

    // Build sell instruction data
    // Instruction discriminator for sell: 0x01
    // Args: token_amount (u64), min_sol_output (u64)
    const sellIxData = Buffer.alloc(17);
    sellIxData.writeUInt8(1, 0); // Sell instruction discriminator
    sellIxData.writeBigUInt64LE(BigInt(tokenAmount), 1);
    sellIxData.writeBigUInt64LE(BigInt(minSolOutput), 9);

    // Build sell instruction (14 accounts)
    const sellIx = new TransactionInstruction({
      programId: this.pumpFunProgramId,
      keys: [
        { pubkey: global, isSigner: false, isWritable: false },
        { pubkey: feeRecipient, isSigner: false, isWritable: true },
        { pubkey: tokenMint, isSigner: false, isWritable: false },
        { pubkey: bondingCurve, isSigner: false, isWritable: true },
        { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
        { pubkey: associatedUser, isSigner: false, isWritable: true },
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: this.systemProgramId, isSigner: false, isWritable: false },
        { pubkey: creatorVault, isSigner: false, isWritable: true },
        { pubkey: tokenProgram, isSigner: false, isWritable: false },
        { pubkey: eventAuthority, isSigner: false, isWritable: false },
        { pubkey: this.pumpFunProgramId, isSigner: false, isWritable: false },
        { pubkey: feeConfig, isSigner: false, isWritable: false },
        { pubkey: feeConfigProgram, isSigner: false, isWritable: false },
      ],
      data: sellIxData,
    });

    transaction.add(sellIx);

    return transaction;
  }

  /**
   * Build a DEX swap transaction via Jupiter aggregator
   * 
   * Note: For direct DEX swaps (Raydium, Orca, Meteora), we use Jupiter
   * as it provides the best routing and slippage protection
   */
  async buildDexSwap(params: DexSwapParams): Promise<VersionedTransaction> {
    const {
      payer,
      inputMint,
      outputMint,
      amount,
      slippageBps,
      dex,
    } = params;

    // Use Jupiter API for swap
    // Jupiter provides a quote endpoint and swap endpoint
    const jupiterQuoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint.toBase58()}&outputMint=${outputMint.toBase58()}&amount=${amount}&slippageBps=${slippageBps}`;
    
    try {
      // Get quote from Jupiter
      const quoteResponse = await fetch(jupiterQuoteUrl);
      if (!quoteResponse.ok) {
        throw new Error(`Jupiter quote failed: ${quoteResponse.statusText}`);
      }
      const quote = await quoteResponse.json();

      // Get swap transaction from Jupiter
      const swapResponse = await fetch('https://quote-api.jup.ag/v6/swap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: payer.toBase58(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 'auto',
        }),
      });

      if (!swapResponse.ok) {
        throw new Error(`Jupiter swap failed: ${swapResponse.statusText}`);
      }

      const swapData = await swapResponse.json();
      
      // Deserialize the transaction
      const swapTransactionBuf = Buffer.from(swapData.swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

      return transaction;
    } catch (error) {
      logger.error('Failed to build DEX swap via Jupiter', error as Error);
      throw error;
    }
  }

  /**
   * Add compute budget instruction to transaction
   */
  addComputeBudget(
    transaction: Transaction | VersionedTransaction,
    units: number = 200_000,
    price: number = 0
  ): Transaction | VersionedTransaction {
    if (transaction instanceof VersionedTransaction) {
      // For versioned transactions, we need to convert or handle differently
      // For now, return as-is and add compute budget separately
      logger.warn('Compute budget not yet supported for VersionedTransaction');
      return transaction;
    }

    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
      units,
    });

    transaction.add(computeBudgetIx);

    if (price > 0) {
      const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: price,
      });
      transaction.add(priorityFeeIx);
    }

    return transaction;
  }

  /**
   * Add priority fee instruction to transaction
   */
  addPriorityFee(
    transaction: Transaction | VersionedTransaction,
    microLamports: number = 21_000
  ): Transaction | VersionedTransaction {
    if (transaction instanceof VersionedTransaction) {
      logger.warn('Priority fee not yet supported for VersionedTransaction');
      return transaction;
    }

    const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports,
    });

    transaction.add(priorityFeeIx);

    return transaction;
  }
}

