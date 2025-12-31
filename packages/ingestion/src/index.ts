/**
 * Ingestion services index
 */

export { parseExport, type ParsedMessage } from './TelegramExportParser.js';
export {
  normalizeTelegramMessage,
  type NormalizedTelegramMessage,
  type NormalizeOk,
  type NormalizeErr,
} from './telegram/normalize.js';
export {
  parseJsonExport,
  type ParseJsonExportResult,
} from './telegram/TelegramJsonExportParser.js';
export {
  TelegramMessageStreamProcessor,
  type StreamProcessorOptions,
  type StreamProcessorResult,
} from './telegram/TelegramMessageStreamProcessor.js';
export {
  ingestJsonExport,
  type IngestJsonExportParams,
  type IngestJsonExportResult,
} from './telegram/TelegramJsonIngestionService.js';
export {
  normalizedToParsed,
  normalizedToParsedBatch,
} from './telegram/normalizedToParsedConverter.js';
// Address validation and extraction
// DEPRECATED: Use @quantbot/utils for address extraction
// Kept for backward compatibility
export { extractSolanaAddresses } from '@quantbot/utils';
export { isBase58, extractAddresses } from './addressValidation.js';

// NOTE: Multi-chain metadata fetching has been moved to @quantbot/api-clients
// These re-exports are removed to maintain offline-only boundary.
// Import directly from @quantbot/api-clients if needed.
// For offline work planning, use DuckDB queries instead.
// TEMPORARILY COMMENTED OUT - needs repository refactoring
// export {
//   TelegramAlertIngestionService,
//   type IngestExportParams,
//   type IngestExportResult,
// } from "./TelegramAlertIngestionService.js";
export {
  OhlcvIngestionService,
  type IngestForCallsParams,
  type IngestForCallsResult,
} from './OhlcvIngestionService.js';
export {
  generateOhlcvWorklist,
  type OhlcvWorkItem,
  type WorklistOptions,
} from './ohlcv-work-planning.js';

// New Telegram Call Ingestion System
export { MessageIndex } from './MessageIndex.js';
export { BotMessageExtractor, type ExtractedBotData } from './BotMessageExtractor.js';
export { CallerResolver, type ResolvedCaller } from './CallerResolver.js';
export {
  ChunkValidator,
  type ChunkValidationResult,
  type ChunkValidatorOptions,
} from './ChunkValidator.js';
// TEMPORARILY COMMENTED OUT - needs repository refactoring
// export {
//   TelegramCallIngestionService,
//   type IngestExportParams as TelegramCallIngestParams,
//   type IngestExportResult as TelegramCallIngestResult,
// } from "./TelegramCallIngestionService.js";
export {
  TelegramPipelineService,
  TelegramPipelineResultSchema,
  type TelegramPipelineResult,
} from './TelegramPipelineService.js';
