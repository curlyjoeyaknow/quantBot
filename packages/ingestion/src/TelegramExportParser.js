"use strict";
/**
 * TelegramExportParser - Parse Telegram HTML export files
 *
 * Parses Telegram HTML export files and extracts messages with metadata.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseExport = parseExport;
const fs = __importStar(require("fs"));
const cheerio = __importStar(require("cheerio"));
const utils_1 = require("@quantbot/utils");
/**
 * Parse a Telegram HTML export file
 */
function parseExport(filePath) {
    utils_1.logger.info('Parsing Telegram export', { filePath });
    if (!fs.existsSync(filePath)) {
        throw new utils_1.NotFoundError('File', filePath);
    }
    const htmlContent = fs.readFileSync(filePath, 'utf8');
    const $ = cheerio.load(htmlContent);
    const messages = [];
    // Find all message elements (Telegram export format)
    $('.message.default, .message').each((_, element) => {
        const $msg = $(element);
        // Skip service messages (date headers, etc.)
        if ($msg.hasClass('service')) {
            return;
        }
        // Extract sender name
        const from = $msg.find('.from_name').text().trim();
        // Extract message text (preserve HTML for bot message extraction)
        const textElement = $msg.find('.text');
        const text = textElement.html() || textElement.text().trim();
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
        // Extract message ID from element id attribute (e.g., id="message149470" -> "149470")
        const messageIdAttr = $msg.attr('id') || '';
        let messageId = messageIdAttr.replace(/^message/, '');
        if (!messageId) {
            // Fallback: generate unique ID if not found
            messageId = `${Date.now()}_${Math.random()}`;
        }
        // Extract reply-to information
        const replyToHref = $msg.find('.reply_to a').attr('href');
        let replyTo;
        let replyToMessageId;
        let replyToFile;
        if (replyToHref) {
            replyTo = replyToHref;
            // Parse reply_to href formats:
            // 1. "#go_to_message149468" (same file)
            // 2. "messages47.html#go_to_message149468" (cross-file)
            const sameFileMatch = replyToHref.match(/#go_to_message(\d+)$/);
            const crossFileMatch = replyToHref.match(/([^/]+\.html)#go_to_message(\d+)$/);
            if (crossFileMatch) {
                // Cross-file reference
                replyToFile = crossFileMatch[1];
                replyToMessageId = crossFileMatch[2];
            }
            else if (sameFileMatch) {
                // Same file reference
                replyToMessageId = sameFileMatch[1];
            }
            else {
                // Try legacy format: "#message123"
                const legacyMatch = replyToHref.match(/#message(\d+)$/);
                if (legacyMatch) {
                    replyToMessageId = legacyMatch[1];
                }
            }
        }
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
            replyToMessageId,
            replyToFile,
        });
    });
    utils_1.logger.info('Parsed Telegram export', {
        filePath,
        messageCount: messages.length,
    });
    return messages;
}
/**
 * Parse Telegram timestamp string to Date
 * Format: "16.01.2025 03:49:06 UTC+10:00" (DD.MM.YYYY HH:mm:ss UTC+offset)
 * This is the EXACT format used in all Telegram exports
 */
function parseTelegramTimestamp(timestampStr) {
    try {
        // Format: "16.01.2025 03:49:06 UTC+10:00"
        // Extract: DD.MM.YYYY HH:mm:ss and UTC offset
        const match = timestampStr.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+UTC([+-])(\d{1,2}):(\d{2})$/);
        if (match) {
            const [, dayStr, monthStr, yearStr, hourStr, minuteStr, secondStr, offsetSign, offsetHourStr, offsetMinuteStr,] = match;
            const day = parseInt(dayStr, 10);
            const month = parseInt(monthStr, 10);
            const year = parseInt(yearStr, 10);
            const hour = parseInt(hourStr, 10);
            const minute = parseInt(minuteStr, 10);
            const second = parseInt(secondStr, 10);
            const offsetHour = parseInt(offsetHourStr, 10);
            const offsetMinute = parseInt(offsetMinuteStr, 10);
            // Create date in UTC (the timestamp is already in local time with offset)
            // If it says UTC+10:00, the local time is 10 hours ahead, so subtract to get UTC
            const offsetTotalMinutes = (offsetHour * 60 + offsetMinute) * (offsetSign === '+' ? -1 : 1);
            // Create UTC date
            const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
            // Adjust for timezone offset
            const adjustedDate = new Date(utcDate.getTime() + offsetTotalMinutes * 60 * 1000);
            return adjustedDate;
        }
        // Fallback: try ISO format
        const isoDate = new Date(timestampStr);
        if (!isNaN(isoDate.getTime())) {
            return isoDate;
        }
        utils_1.logger.warn('Could not parse timestamp', { timestampStr });
        return null;
    }
    catch (error) {
        utils_1.logger.warn('Error parsing timestamp', {
            error: error instanceof Error ? error.message : String(error),
            timestampStr,
        });
        return null;
    }
}
/**
 * Extract chat ID from HTML or file path
 */
function extractChatId($, filePath) {
    // Try to find chat info in HTML
    const chatTitle = $('.page_title').text().trim();
    if (chatTitle) {
        // Use chat title as identifier
        return chatTitle.toLowerCase().replace(/\s+/g, '_');
    }
    // Extract from file path (e.g., "messages/brook7/messages.html" -> "brook7")
    const pathMatch = filePath.match(/messages\/([^/]+)\//);
    if (pathMatch) {
        return pathMatch[1];
    }
    return undefined;
}
//# sourceMappingURL=TelegramExportParser.js.map