/**
 * ChunkValidator - Validate extracted data in small chunks
 *
 * Processes and validates extracted data in configurable chunks
 * with detailed logging for debugging
 */
import type { ExtractedBotData } from './BotMessageExtractor';
import type { ResolvedCaller } from './CallerResolver';
export interface ChunkValidationResult {
  botData: ExtractedBotData;
  caller: ResolvedCaller;
}
export interface ChunkValidatorOptions {
  chunkSize?: number;
  validateAddresses?: boolean;
  maxAddressValidations?: number;
}
export declare class ChunkValidator {
  private chunkSize;
  private validateAddresses;
  private maxAddressValidations;
  private validationCount;
  constructor(options?: ChunkValidatorOptions);
  /**
   * Validate a chunk of extracted data
   * @param results - Array of extracted bot data + caller info
   * @param chunkIndex - Current chunk index (0-based)
   * @returns true if chunk is valid, false otherwise
   */
  validateChunk(results: ChunkValidationResult[], chunkIndex: number): Promise<boolean>;
  /**
   * Get validation statistics
   */
  getStats(): {
    totalValidations: number;
    chunkSize: number;
  };
}
//# sourceMappingURL=ChunkValidator.d.ts.map
