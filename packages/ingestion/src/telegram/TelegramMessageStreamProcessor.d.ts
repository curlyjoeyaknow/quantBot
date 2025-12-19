/**
 * TelegramMessageStreamProcessor - Process normalized messages to NDJSON streams
 *
 * Writes normalized messages and quarantined messages to separate NDJSON files.
 * This enables debugging and reprocessing without re-parsing exports.
 */
import type { NormalizedTelegramMessage, NormalizeErr } from './normalize';
export interface StreamProcessorOptions {
  outputDir?: string;
  writeNormalized?: boolean;
  writeQuarantine?: boolean;
}
export interface StreamProcessorResult {
  normalizedWritten: number;
  quarantinedWritten: number;
  normalizedPath?: string;
  quarantinePath?: string;
}
/**
 * Process normalized and quarantined messages to NDJSON streams
 */
export declare class TelegramMessageStreamProcessor {
  private options;
  private normalizedPath?;
  private quarantinePath?;
  private normalizedStream?;
  private quarantineStream?;
  private normalizedCount;
  private quarantinedCount;
  constructor(options?: StreamProcessorOptions);
  /**
   * Initialize output streams
   */
  initialize(baseName: string): void;
  /**
   * Write a normalized message
   */
  writeNormalized(message: NormalizedTelegramMessage): void;
  /**
   * Write a quarantined message with error
   */
  writeQuarantine(error: NormalizeErr['error'], raw: unknown): void;
  /**
   * Write multiple normalized messages
   */
  writeNormalizedBatch(messages: NormalizedTelegramMessage[]): void;
  /**
   * Write multiple quarantined messages
   */
  writeQuarantineBatch(
    quarantined: Array<{
      error: NormalizeErr['error'];
      raw: unknown;
    }>
  ): void;
  /**
   * Close all streams and return results
   */
  close(): Promise<StreamProcessorResult>;
  /**
   * Synchronous close (for compatibility)
   */
  closeSync(): StreamProcessorResult;
  /**
   * Get current statistics
   */
  getStats(): {
    normalized: number;
    quarantined: number;
  };
}
//# sourceMappingURL=TelegramMessageStreamProcessor.d.ts.map
