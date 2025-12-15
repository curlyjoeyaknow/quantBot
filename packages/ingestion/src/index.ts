/**
 * Ingestion services index
 */

export { parseExport, type ParsedMessage } from './TelegramExportParser';
export { extractSolanaAddresses } from './extractSolanaAddresses';

// Address validation and extraction
export { isEvmAddress, isSolanaAddress, isBase58, extractAddresses } from './addressValidation.js';

// Multi-chain metadata fetching
export {
  fetchMultiChainMetadata,
  batchFetchMultiChainMetadata,
  type TokenMetadata,
  type MultiChainMetadataResult,
} from './MultiChainMetadataService.js';
export {
  TelegramAlertIngestionService,
  type IngestExportParams,
  type IngestExportResult,
} from './TelegramAlertIngestionService';
export {
  OhlcvIngestionService,
  type IngestForCallsParams,
  type IngestForCallsResult,
} from './OhlcvIngestionService';

// New Telegram Call Ingestion System
export { MessageIndex } from './MessageIndex';
export { BotMessageExtractor, type ExtractedBotData } from './BotMessageExtractor';
export { CallerResolver, type ResolvedCaller } from './CallerResolver';
export {
  ChunkValidator,
  type ChunkValidationResult,
  type ChunkValidatorOptions,
} from './ChunkValidator';
export {
  TelegramCallIngestionService,
  type IngestExportParams as TelegramCallIngestParams,
  type IngestExportResult as TelegramCallIngestResult,
} from './TelegramCallIngestionService';
