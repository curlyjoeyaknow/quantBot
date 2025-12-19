/**
 * TelegramExportParser - Parse Telegram HTML export files
 *
 * Parses Telegram HTML export files and extracts messages with metadata.
 */
export interface ParsedMessage {
    timestamp: Date;
    chatId?: string;
    messageId: string;
    text: string;
    from?: string;
    replyTo?: string;
    replyToMessageId?: string;
    replyToFile?: string;
}
/**
 * Parse a Telegram HTML export file
 */
export declare function parseExport(filePath: string): ParsedMessage[];
//# sourceMappingURL=TelegramExportParser.d.ts.map