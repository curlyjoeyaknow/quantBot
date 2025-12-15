/**
 * ChunkValidator - Validate extracted data in small chunks
 *
 * Processes and validates extracted data in configurable chunks
 * with detailed logging for debugging
 */

import { logger } from '@quantbot/utils';
import type { ExtractedBotData } from './BotMessageExtractor';
import type { ResolvedCaller } from './CallerResolver';

export interface ChunkValidationResult {
  botData: ExtractedBotData;
  caller: ResolvedCaller;
}

export interface ChunkValidatorOptions {
  chunkSize?: number; // Default: 10
  validateAddresses?: boolean; // Default: false (can enable Birdeye validation)
  maxAddressValidations?: number; // Default: 10 (first N addresses)
}

export class ChunkValidator {
  private chunkSize: number;
  private validateAddresses: boolean;
  private maxAddressValidations: number;
  private validationCount: number = 0;

  constructor(options: ChunkValidatorOptions = {}) {
    this.chunkSize = options.chunkSize ?? 10;
    this.validateAddresses = options.validateAddresses ?? false;
    this.maxAddressValidations = options.maxAddressValidations ?? 10;
  }

  /**
   * Validate a chunk of extracted data
   * @param results - Array of extracted bot data + caller info
   * @param chunkIndex - Current chunk index (0-based)
   * @returns true if chunk is valid, false otherwise
   */
  async validateChunk(results: ChunkValidationResult[], chunkIndex: number): Promise<boolean> {
    logger.info(`Validating chunk ${chunkIndex + 1} (${results.length} items)`);

    let validCount = 0;
    let invalidCount = 0;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const itemIndex = chunkIndex * this.chunkSize + i + 1;

      try {
        // Basic structure validation
        if (!result.botData.contractAddress) {
          logger.warn(`Item ${itemIndex}: Missing contract address`);
          invalidCount++;
          continue;
        }

        if (!result.caller.callerName) {
          logger.warn(`Item ${itemIndex}: Missing caller name`);
          invalidCount++;
          continue;
        }

        // Log extracted data for validation
        logger.debug(`Item ${itemIndex} extracted:`, {
          contractAddress: result.botData.contractAddress.substring(0, 20) + '...',
          chain: result.botData.chain,
          tokenName: result.botData.tokenName,
          ticker: result.botData.ticker,
          price: result.botData.price,
          marketCap: result.botData.marketCap,
          caller: result.caller.callerName,
          alertTime: result.caller.alertTimestamp.toISOString(),
        });

        // Optional: Validate contract address via Birdeye (first N only)
        if (this.validateAddresses && this.validationCount < this.maxAddressValidations) {
          this.validationCount++;
          // Note: Birdeye validation would be implemented here if needed
          // For now, we just log that validation would happen
          logger.debug(
            `Would validate address ${result.botData.contractAddress.substring(0, 20)}... via Birdeye`
          );
        }

        validCount++;
      } catch (error) {
        logger.error(`Item ${itemIndex}: Validation error`, error as Error);
        invalidCount++;
      }
    }

    logger.info(`Chunk ${chunkIndex + 1} validation complete:`, {
      valid: validCount,
      invalid: invalidCount,
      total: results.length,
    });

    return invalidCount === 0;
  }

  /**
   * Get validation statistics
   */
  getStats(): {
    totalValidations: number;
    chunkSize: number;
  } {
    return {
      totalValidations: this.validationCount,
      chunkSize: this.chunkSize,
    };
  }
}
