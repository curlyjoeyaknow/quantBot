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
export { extractSolanaAddresses } from './extractSolanaAddresses.js';

// Address validation and extraction (isEvmAddress, isSolanaAddress moved to @quantbot/utils)
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
// MarketDataIngestionService moved to @quantbot/jobs (makes network calls)
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

// Alert Ingestion (Phase VI)
export {
  normalizeAlerts,
  type CanonicalAlert,
  type NormalizeAlertsOptions,
  type NormalizeAlertsResult,
} from './alerts/normalize.js';
export {
  validateAlerts,
  getValidationSummary,
  type ValidationResult,
  type InvalidAlert,
  type ValidationErrorCode,
} from './alerts/validate.js';
export { quarantineAlerts, type QuarantineResult } from './alerts/quarantine.js';
export {
  ingestTelegramAlertsHandler,
  type IngestTelegramAlertsArgs,
  type IngestTelegramAlertsResult,
} from './handlers/ingest-telegram-alerts.js';
