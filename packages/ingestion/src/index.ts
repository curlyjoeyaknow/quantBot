/**
 * Ingestion services index
 */

export { parseExport, type ParsedMessage } from './TelegramExportParser';
export {
  normalizeTelegramMessage,
  type NormalizedTelegramMessage,
  type NormalizeOk,
  type NormalizeErr,
} from './telegram/normalize';
export { parseJsonExport, type ParseJsonExportResult } from './telegram/TelegramJsonExportParser';
export {
  TelegramMessageStreamProcessor,
  type StreamProcessorOptions,
  type StreamProcessorResult,
} from './telegram/TelegramMessageStreamProcessor';
export {
  ingestJsonExport,
  type IngestJsonExportParams,
  type IngestJsonExportResult,
} from './telegram/TelegramJsonIngestionService';
export {
  normalizedToParsed,
  normalizedToParsedBatch,
} from './telegram/normalizedToParsedConverter';
export { extractSolanaAddresses } from './extractSolanaAddresses';

// Address validation and extraction (isEvmAddress, isSolanaAddress moved to @quantbot/utils)
export { isBase58, extractAddresses } from './addressValidation';

// NOTE: Multi-chain metadata fetching has been moved to @quantbot/api-clients
// These re-exports are removed to maintain offline-only boundary.
// Import directly from @quantbot/api-clients if needed.
// For offline work planning, use DuckDB queries instead.
// TEMPORARILY COMMENTED OUT - needs repository refactoring
// export {
//   TelegramAlertIngestionService,
//   type IngestExportParams,
//   type IngestExportResult,
// } from './TelegramAlertIngestionService';
export {
  OhlcvIngestionService,
  type IngestForCallsParams,
  type IngestForCallsResult,
} from './OhlcvIngestionService';
export {
  generateOhlcvWorklist,
  type OhlcvWorkItem,
  type WorklistOptions,
} from './ohlcv-work-planning';

// New Telegram Call Ingestion System
export { MessageIndex } from './MessageIndex';
export { BotMessageExtractor, type ExtractedBotData } from './BotMessageExtractor';
export { CallerResolver, type ResolvedCaller } from './CallerResolver';
export {
  ChunkValidator,
  type ChunkValidationResult,
  type ChunkValidatorOptions,
} from './ChunkValidator';
// TEMPORARILY COMMENTED OUT - needs repository refactoring
// export {
//   TelegramCallIngestionService,
//   type IngestExportParams as TelegramCallIngestParams,
//   type IngestExportResult as TelegramCallIngestResult,
// } from './TelegramCallIngestionService';
export {
  TelegramPipelineService,
  TelegramPipelineResultSchema,
  type TelegramPipelineResult,
} from './TelegramPipelineService';
