"use strict";
/**
 * MessageIndex - Build in-memory index for fast message lookup
 *
 * Supports:
 * - Single-file message lookup
 * - Cross-file message resolution
 * - Handling duplicate message IDs across files
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageIndex = void 0;
class MessageIndex {
    // Map: messageId -> Map<fileName, ParsedMessage>
    // This allows handling duplicate message IDs across files
    index = new Map();
    /**
     * Add messages from a file to the index
     */
    addMessages(fileName, messages) {
        for (const message of messages) {
            if (!this.index.has(message.messageId)) {
                this.index.set(message.messageId, new Map());
            }
            this.index.get(message.messageId).set(fileName, message);
        }
    }
    /**
     * Get a message by ID
     * @param messageId - The message ID to look up
     * @param fileName - Optional file name to disambiguate duplicates
     * @returns The message if found, undefined otherwise
     */
    getMessage(messageId, fileName) {
        const fileMap = this.index.get(messageId);
        if (!fileMap) {
            return undefined;
        }
        // If file is specified, get from that file
        if (fileName) {
            return fileMap.get(fileName);
        }
        // If no file specified, return the first one found
        // (In practice, this works for same-file lookups)
        return fileMap.values().next().value;
    }
    /**
     * Resolve a reply_to reference to the actual caller message
     * @param message - The message with reply_to information
     * @param currentFileName - The file name where the message is from
     * @returns The caller message if found, undefined otherwise
     */
    resolveReplyTo(message, currentFileName) {
        if (!message.replyToMessageId) {
            return undefined;
        }
        // If reply_to specifies a file, use that file
        if (message.replyToFile) {
            return this.getMessage(message.replyToMessageId, message.replyToFile);
        }
        // Otherwise, look in the current file (or try all files if not specified)
        if (currentFileName) {
            return this.getMessage(message.replyToMessageId, currentFileName);
        }
        // Fallback: try to find in any file
        return this.getMessage(message.replyToMessageId);
    }
    /**
     * Get all messages indexed
     */
    getAllMessages() {
        const allMessages = [];
        for (const fileMap of this.index.values()) {
            for (const message of fileMap.values()) {
                allMessages.push(message);
            }
        }
        return allMessages;
    }
    /**
     * Get count of indexed messages
     */
    getMessageCount() {
        let count = 0;
        for (const fileMap of this.index.values()) {
            count += fileMap.size;
        }
        return count;
    }
    /**
     * Clear the index
     */
    clear() {
        this.index.clear();
    }
}
exports.MessageIndex = MessageIndex;
//# sourceMappingURL=MessageIndex.js.map