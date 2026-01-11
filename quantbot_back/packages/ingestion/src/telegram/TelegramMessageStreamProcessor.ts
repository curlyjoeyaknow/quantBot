/**
 * TelegramMessageStreamProcessor - Process normalized messages to NDJSON streams
 *
 * Writes normalized messages and quarantined messages to separate NDJSON files.
 * This enables debugging and reprocessing without re-parsing exports.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '@quantbot/utils';
import type { NormalizedTelegramMessage, NormalizeErr } from './normalize.js';

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
export class TelegramMessageStreamProcessor {
  private normalizedPath?: string;
  private quarantinePath?: string;
  private normalizedStream?: fs.WriteStream;
  private quarantineStream?: fs.WriteStream;
  private normalizedCount = 0;
  private quarantinedCount = 0;

  constructor(private options: StreamProcessorOptions = {}) {}

  /**
   * Initialize output streams
   */
  initialize(baseName: string): void {
    const outputDir = this.options.outputDir || process.cwd();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

    if (this.options.writeNormalized !== false) {
      this.normalizedPath = path.join(
        outputDir,
        `${baseName}_normalized_messages_${timestamp}.ndjson`
      );
      this.normalizedStream = fs.createWriteStream(this.normalizedPath, { flags: 'w' });
      logger.info('Initialized normalized messages stream', { path: this.normalizedPath });
    }

    if (this.options.writeQuarantine !== false) {
      this.quarantinePath = path.join(outputDir, `${baseName}_quarantine_${timestamp}.ndjson`);
      this.quarantineStream = fs.createWriteStream(this.quarantinePath, { flags: 'w' });
      logger.info('Initialized quarantine stream', { path: this.quarantinePath });
    }
  }

  /**
   * Write a normalized message
   */
  writeNormalized(message: NormalizedTelegramMessage): void {
    if (!this.normalizedStream) return;

    const line = JSON.stringify(message) + '\n';
    this.normalizedStream.write(line);
    this.normalizedCount++;
  }

  /**
   * Write a quarantined message with error
   */
  writeQuarantine(error: NormalizeErr['error'], raw: unknown): void {
    if (!this.quarantineStream) return;

    const record = {
      error: {
        code: error.code,
        message: error.message,
      },
      raw,
      timestamp: new Date().toISOString(),
    };

    const line = JSON.stringify(record) + '\n';
    this.quarantineStream.write(line);
    this.quarantinedCount++;
  }

  /**
   * Write multiple normalized messages
   */
  writeNormalizedBatch(messages: NormalizedTelegramMessage[]): void {
    for (const message of messages) {
      this.writeNormalized(message);
    }
  }

  /**
   * Write multiple quarantined messages
   */
  writeQuarantineBatch(quarantined: Array<{ error: NormalizeErr['error']; raw: unknown }>): void {
    for (const item of quarantined) {
      this.writeQuarantine(item.error, item.raw);
    }
  }

  /**
   * Close all streams and return results
   */
  async close(): Promise<StreamProcessorResult> {
    const closeStream = (stream: fs.WriteStream | undefined): Promise<void> => {
      if (!stream) return Promise.resolve();

      return new Promise<void>((resolve, reject) => {
        stream.end((err: Error | null | undefined) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    };

    await Promise.all([closeStream(this.normalizedStream), closeStream(this.quarantineStream)]);

    const result: StreamProcessorResult = {
      normalizedWritten: this.normalizedCount,
      quarantinedWritten: this.quarantinedCount,
      normalizedPath: this.normalizedPath,
      quarantinePath: this.quarantinePath,
    };

    logger.info('Closed message streams', {
      normalized: this.normalizedCount,
      quarantined: this.quarantinedCount,
    });

    return result;
  }

  /**
   * Synchronous close (for compatibility)
   */
  closeSync(): StreamProcessorResult {
    if (this.normalizedStream) {
      this.normalizedStream.end();
    }
    if (this.quarantineStream) {
      this.quarantineStream.end();
    }

    return {
      normalizedWritten: this.normalizedCount,
      quarantinedWritten: this.quarantinedCount,
      normalizedPath: this.normalizedPath,
      quarantinePath: this.quarantinePath,
    };
  }

  /**
   * Get current statistics
   */
  getStats(): { normalized: number; quarantined: number } {
    return {
      normalized: this.normalizedCount,
      quarantined: this.quarantinedCount,
    };
  }
}
