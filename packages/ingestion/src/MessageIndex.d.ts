/**
 * MessageIndex - Build in-memory index for fast message lookup
 *
 * Supports:
 * - Single-file message lookup
 * - Cross-file message resolution
 * - Handling duplicate message IDs across files
 */
import type { ParsedMessage } from './TelegramExportParser';
export declare class MessageIndex {
    private index;
    /**
     * Add messages from a file to the index
     */
    addMessages(fileName: string, messages: ParsedMessage[]): void;
    /**
     * Get a message by ID
     * @param messageId - The message ID to look up
     * @param fileName - Optional file name to disambiguate duplicates
     * @returns The message if found, undefined otherwise
     */
    getMessage(messageId: string, fileName?: string): ParsedMessage | undefined;
    /**
     * Resolve a reply_to reference to the actual caller message
     * @param message - The message with reply_to information
     * @param currentFileName - The file name where the message is from
     * @returns The caller message if found, undefined otherwise
     */
    resolveReplyTo(message: ParsedMessage, currentFileName?: string): ParsedMessage | undefined;
    /**
     * Get all messages indexed
     */
    getAllMessages(): ParsedMessage[];
    /**
     * Get count of indexed messages
     */
    getMessageCount(): number;
    /**
     * Clear the index
     */
    clear(): void;
}
//# sourceMappingURL=MessageIndex.d.ts.map