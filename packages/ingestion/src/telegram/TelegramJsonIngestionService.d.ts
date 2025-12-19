/**
 * TelegramJsonIngestionService - Ingest Telegram JSON exports with normalization
 *
 * Pipeline: raw -> normalize -> validate -> store
 *
 * Outputs:
 * - normalized_messages.ndjson (good messages)
 * - quarantine.ndjson (bad messages + error codes)
 */
import { type StreamProcessorResult } from './TelegramMessageStreamProcessor';
export interface IngestJsonExportParams {
  filePath: string;
  chatId?: string;
  outputDir?: string;
  writeStreams?: boolean;
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
export declare function ingestJsonExport(
  params: IngestJsonExportParams
): Promise<IngestJsonExportResult>;
//# sourceMappingURL=TelegramJsonIngestionService.d.ts.map
