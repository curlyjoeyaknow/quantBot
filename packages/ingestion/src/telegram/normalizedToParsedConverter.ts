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
export function normalizedToParsed(normalized: NormalizedTelegramMessage): ParsedMessage {
  return {
    timestamp: new Date(normalized.timestampMs),
    chatId: normalized.chatId,
    messageId: String(normalized.messageId),
    text: normalized.text,
    from: normalized.fromName || undefined,
    replyToMessageId:
      normalized.replyToMessageId !== null && normalized.replyToMessageId !== undefined
        ? String(normalized.replyToMessageId)
        : undefined,
    // Note: replyTo and replyToFile are not available from normalized messages
    // They would need to be resolved from the message index if needed
  };
}

/**
 * Convert multiple normalized messages to ParsedMessage format
 */
export function normalizedToParsedBatch(normalized: NormalizedTelegramMessage[]): ParsedMessage[] {
  return normalized.map(normalizedToParsed);
}
