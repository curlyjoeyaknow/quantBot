/**
 * Converter from NormalizedTelegramMessage to ParsedMessage
 *
 * Allows using normalized JSON messages with existing ingestion services
 * that expect ParsedMessage format.
 */
import type { NormalizedTelegramMessage } from './normalize';
import type { ParsedMessage } from '../TelegramExportParser';
/**
 * Convert a normalized message to ParsedMessage format
 */
export declare function normalizedToParsed(normalized: NormalizedTelegramMessage): ParsedMessage;
/**
 * Convert multiple normalized messages to ParsedMessage format
 */
export declare function normalizedToParsedBatch(normalized: NormalizedTelegramMessage[]): ParsedMessage[];
//# sourceMappingURL=normalizedToParsedConverter.d.ts.map