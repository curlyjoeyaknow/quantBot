/**
 * DEX Transaction Parser
 * Parses transactions from Raydium, Orca, Meteora to extract prices and mints
 * Based on Shyft examples: https://github.com/Shyft-to/solana-defi
 */
export interface SwapEvent {
  type: 'Buy' | 'Sell';
  mint: string;
  amountIn: number | string;
  amountOut: number | string;
  price?: number;
  user?: string;
}
export declare class DexTransactionParser {
  private transactionFormatter;
  private readonly PUMP_FUN_PROGRAM_ID;
  private readonly RAYDIUM_AMM_PROGRAM_ID;
  private readonly ORCA_WHIRLPOOL_PROGRAM_ID;
  private readonly METEORA_DBC_PROGRAM_ID;
  private readonly SOL_MINT;
  private readonly USDC_MINT;
  constructor();
  /**
   * Parse transaction and extract swap events
   */
  parseTransaction(data: any): SwapEvent | null;
  /**
   * Extract mint from Pump.fun token creation transaction
   */
  extractMintFromPumpFunCreation(data: any): string | null;
  private getProgramIds;
  private parsePumpFunTransaction;
  private parseRaydiumTransaction;
  private parseOrcaTransaction;
  private parseMeteoraTransaction;
}
//# sourceMappingURL=dex-transaction-parser.d.ts.map
