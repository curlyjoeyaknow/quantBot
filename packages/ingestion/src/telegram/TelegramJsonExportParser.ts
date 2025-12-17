/**
 * TelegramJsonExportParser - Parse Telegram JSON export files
 *
 * Parses Telegram JSON export files and normalizes messages using the normalizer.
 * Handles the standard Telegram export JSON format.
 */

import * as fs from 'fs';
import { logger, NotFoundError, ValidationError } from '@quantbot/utils';
import {
  normalizeTelegramMessage,
  type NormalizedTelegramMessage,
  type NormalizeErr,
} from './normalize';

export interface ParseJsonExportResult {
  normalized: NormalizedTelegramMessage[];
  quarantined: Array<{ error: NormalizeErr['error']; raw: unknown }>;
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
export function parseJsonExport(filePath: string, chatId?: string): ParseJsonExportResult {
  logger.info('Parsing Telegram JSON export', { filePath });

  if (!fs.existsSync(filePath)) {
    throw new NotFoundError('File', filePath);
  }

  const fileContent = fs.readFileSync(filePath, 'utf8');
  let exportData: any;

  try {
    exportData = JSON.parse(fileContent);
  } catch (error) {
    throw new ValidationError(
      `Invalid JSON in file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      { filePath, error: error instanceof Error ? error.message : String(error) }
    );
  }

  // Extract chat ID from export or use provided
  const resolvedChatId = chatId || extractChatId(exportData, filePath);

  // Extract messages array
  const rawMessages = exportData.messages || [];
  if (!Array.isArray(rawMessages)) {
    throw new ValidationError(`Expected messages array in export file ${filePath}`, {
      filePath,
      dataType: typeof exportData.messages,
    });
  }

  logger.info('Found raw messages', { count: rawMessages.length, chatId: resolvedChatId });

  const normalized: NormalizedTelegramMessage[] = [];
  const quarantined: Array<{ error: NormalizeErr['error']; raw: unknown }> = [];

  // Process each message: raw -> normalize
  for (const rawMessage of rawMessages) {
    const result = normalizeTelegramMessage(rawMessage, resolvedChatId);

    if (result.ok) {
      normalized.push(result.value);
    } else {
      // TypeScript now knows result is NormalizeErr
      quarantined.push({
        error: result.error,
        raw: result.raw,
      });
    }
  }

  logger.info('Parsed Telegram JSON export', {
    filePath,
    totalProcessed: rawMessages.length,
    normalized: normalized.length,
    quarantined: quarantined.length,
  });

  return {
    normalized,
    quarantined,
    totalProcessed: rawMessages.length,
  };
}

/**
 * Extract chat ID from export data or file path
 */
function extractChatId(exportData: any, filePath: string): string {
  // Try to get from export data
  if (exportData.name && typeof exportData.name === 'string') {
    // Use chat name as identifier
    return exportData.name.toLowerCase().replace(/\s+/g, '_');
  }

  if (exportData.id !== null && exportData.id !== undefined) {
    return String(exportData.id);
  }

  // Extract from file path (e.g., "messages/brook7/messages.json" -> "brook7")
  const pathMatch = filePath.match(/messages[\/\\]([^\/\\]+)[\/\\]/);
  if (pathMatch) {
    return pathMatch[1];
  }

  // Fallback to filename without extension
  const fileName = filePath.split(/[\/\\]/).pop() || 'unknown';
  return fileName.replace(/\.json$/, '');
}
