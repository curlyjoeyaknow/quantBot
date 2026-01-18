/**
 * TelegramJsonIngestionService - Ingest Telegram JSON exports with normalization
 *
 * Pipeline: raw -> normalize -> validate -> store
 *
 * Outputs:
 * - normalized_messages.ndjson (good messages)
 * - quarantine.ndjson (bad messages + error codes)
 */

import * as path from 'path';
import { logger } from '@quantbot/infra/utils';
import { parseJsonExport } from './TelegramJsonExportParser.js';
import {
  TelegramMessageStreamProcessor,
  type StreamProcessorResult,
} from './TelegramMessageStreamProcessor.js';

export interface IngestJsonExportParams {
  filePath: string;
  chatId?: string;
  outputDir?: string;
  writeStreams?: boolean; // Whether to write NDJSON streams
}

export interface IngestJsonExportResult {
  totalProcessed: number;
  normalized: number;
  quarantined: number;
  streamResult?: StreamProcessorResult;
}

/**
 * Ingest a Telegram JSON export file with normalization and quarantine
 */
export async function ingestJsonExport(
  params: IngestJsonExportParams
): Promise<IngestJsonExportResult> {
  logger.info('Starting Telegram JSON export ingestion', {
    filePath: params.filePath,
    chatId: params.chatId,
  });

  // 1. Parse and normalize: raw -> normalize
  const parseResult = parseJsonExport(params.filePath, params.chatId);

  logger.info('Normalization complete', {
    totalProcessed: parseResult.totalProcessed,
    normalized: parseResult.normalized.length,
    quarantined: parseResult.quarantined.length,
  });

  // 2. Write streams if requested
  let streamResult: StreamProcessorResult | undefined;

  if (params.writeStreams !== false) {
    const baseName = path.basename(params.filePath, path.extname(params.filePath));
    const processor = new TelegramMessageStreamProcessor({
      outputDir: params.outputDir,
      writeNormalized: true,
      writeQuarantine: true,
    });

    processor.initialize(baseName);
    processor.writeNormalizedBatch(parseResult.normalized);
    processor.writeQuarantineBatch(parseResult.quarantined);
    streamResult = await processor.close();

    logger.info('Streams written', {
      normalizedPath: streamResult.normalizedPath,
      quarantinePath: streamResult.quarantinePath,
    });
  }

  return {
    totalProcessed: parseResult.totalProcessed,
    normalized: parseResult.normalized.length,
    quarantined: parseResult.quarantined.length,
    streamResult,
  };
}
