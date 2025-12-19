/**
 * TelegramJsonExportParser - Parse Telegram JSON export files
 *
 * Parses Telegram JSON export files and normalizes messages using the normalizer.
 * Handles the standard Telegram export JSON format.
 */
import { type NormalizedTelegramMessage, type NormalizeErr } from './normalize';
export interface ParseJsonExportResult {
  normalized: NormalizedTelegramMessage[];
  quarantined: Array<{
    error: NormalizeErr['error'];
    raw: unknown;
  }>;
  totalProcessed: number;
}
/**
 * Parse a Telegram JSON export file
 *
 * Telegram JSON exports typically have this structure:
 * {
 *   "name": "Chat Name",
 *   "type": "private_group",
 *   "id": 123456789,
 *   "messages": [
 *     { "id": 1, "type": "message", "date": "...", "text": "...", ... },
 *     ...
 *   ]
 * }
 */
export declare function parseJsonExport(filePath: string, chatId?: string): ParseJsonExportResult;
//# sourceMappingURL=TelegramJsonExportParser.d.ts.map
