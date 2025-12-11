/**
 * TelegramExportParser - Parse Telegram HTML export files
 * 
 * Parses Telegram HTML export files and extracts messages with metadata.
 */

import * as fs from 'fs';
import * as cheerio from 'cheerio';
import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';

export interface ParsedMessage {
  timestamp: Date;
  chatId?: string;
  messageId: string;
  text: string;
  from?: string;
  replyTo?: string;
}

/**
 * Parse a Telegram HTML export file
 */
export function parseExport(filePath: string): ParsedMessage[] {
  logger.info('Parsing Telegram export', { filePath });

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const htmlContent = fs.readFileSync(filePath, 'utf8');
  const $ = cheerio.load(htmlContent);
  const messages: ParsedMessage[] = [];

  // Find all message elements (Telegram export format)
  $('.message.default, .message').each((_, element) => {
    const $msg = $(element);

    // Skip service messages (date headers, etc.)
    if ($msg.hasClass('service')) {
      return;
    }

    // Extract sender name
    const from = $msg.find('.from_name').text().trim();

    // Extract message text
    const text = $msg.find('.text').text().trim();

    if (!text) {
      return; // Skip empty messages
    }

    // Extract timestamp
    const dateTitle = $msg.find('.date.details, .date').attr('title');
    if (!dateTitle) {
      return; // Skip messages without timestamp
    }

    const timestamp = parseTelegramTimestamp(dateTitle);
    if (!timestamp) {
      return; // Skip invalid timestamps
    }

    // Extract message ID
    const messageIdAttr = $msg.attr('id') || '';
    const messageId = messageIdAttr.replace('message', '') || `${Date.now()}_${Math.random()}`;

    // Extract reply-to (if present)
    const replyTo = $msg.find('.reply_to').attr('href')?.replace('#message', '') || undefined;

    // Extract chat ID from file path or message structure
    // Telegram exports sometimes include chat info in the HTML
    const chatId = extractChatId($, filePath);

    messages.push({
      timestamp,
      chatId,
      messageId,
      text,
      from: from || undefined,
      replyTo,
    });
  });

  logger.info('Parsed Telegram export', {
    filePath,
    messageCount: messages.length,
  });

  return messages;
}

/**
 * Parse Telegram timestamp string to Date
 * Handles formats like "2024-01-15 14:30:00" or ISO strings
 */
function parseTelegramTimestamp(timestampStr: string): Date | null {
  try {
    // Try ISO format first
    const isoDate = new Date(timestampStr);
    if (!isNaN(isoDate.getTime())) {
      return isoDate;
    }

    // Try Telegram format: "15.01.2024 14:30:00" or "2024-01-15 14:30:00"
    const telegramFormat = timestampStr.replace(/\./g, '-');
    const parsed = DateTime.fromFormat(telegramFormat, 'yyyy-MM-dd HH:mm:ss', { zone: 'utc' });
    if (parsed.isValid) {
      return parsed.toJSDate();
    }

    // Try another common format
    const parsed2 = DateTime.fromFormat(timestampStr, 'dd.MM.yyyy HH:mm:ss', { zone: 'utc' });
    if (parsed2.isValid) {
      return parsed2.toJSDate();
    }

    logger.warn('Could not parse timestamp', { timestampStr });
    return null;
  } catch (error) {
    logger.warn('Error parsing timestamp', error as Error, { timestampStr });
    return null;
  }
}

/**
 * Extract chat ID from HTML or file path
 */
function extractChatId($: cheerio.CheerioAPI, filePath: string): string | undefined {
  // Try to find chat info in HTML
  const chatTitle = $('.page_title').text().trim();
  if (chatTitle) {
    // Use chat title as identifier
    return chatTitle.toLowerCase().replace(/\s+/g, '_');
  }

  // Extract from file path (e.g., "messages/brook7/messages.html" -> "brook7")
  const pathMatch = filePath.match(/messages\/([^\/]+)\//);
  if (pathMatch) {
    return pathMatch[1];
  }

  return undefined;
}

