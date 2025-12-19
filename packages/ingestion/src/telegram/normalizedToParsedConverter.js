"use strict";
/**
 * Converter from NormalizedTelegramMessage to ParsedMessage
 *
 * Allows using normalized JSON messages with existing ingestion services
 * that expect ParsedMessage format.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizedToParsed = normalizedToParsed;
exports.normalizedToParsedBatch = normalizedToParsedBatch;
/**
 * Convert a normalized message to ParsedMessage format
 */
function normalizedToParsed(normalized) {
    return {
        timestamp: new Date(normalized.timestampMs),
        chatId: normalized.chatId,
        messageId: String(normalized.messageId),
        text: normalized.text,
        from: normalized.fromName || undefined,
        replyToMessageId: normalized.replyToMessageId !== null && normalized.replyToMessageId !== undefined
            ? String(normalized.replyToMessageId)
            : undefined,
        // Note: replyTo and replyToFile are not available from normalized messages
        // They would need to be resolved from the message index if needed
    };
}
/**
 * Convert multiple normalized messages to ParsedMessage format
 */
function normalizedToParsedBatch(normalized) {
    return normalized.map(normalizedToParsed);
}
//# sourceMappingURL=normalizedToParsedConverter.js.map