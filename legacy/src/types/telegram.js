"use strict";
/**
 * Telegram Bot Types
 * ==================
 * Type definitions for Telegram bot interactions.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCallbackQuery = isCallbackQuery;
exports.isMessageUpdate = isMessageUpdate;
exports.isTextMessage = isTextMessage;
/**
 * Type guard for callback query
 */
function isCallbackQuery(update) {
    return 'callback_query' in update;
}
/**
 * Type guard for message update
 */
function isMessageUpdate(update) {
    return 'message' in update;
}
/**
 * Type guard for text message
 */
function isTextMessage(message) {
    return 'text' in message && typeof message.text === 'string';
}
//# sourceMappingURL=telegram.js.map