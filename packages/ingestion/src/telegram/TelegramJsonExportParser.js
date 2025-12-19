"use strict";
/**
 * TelegramJsonExportParser - Parse Telegram JSON export files
 *
 * Parses Telegram JSON export files and normalizes messages using the normalizer.
 * Handles the standard Telegram export JSON format.
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
exports.parseJsonExport = parseJsonExport;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const utils_1 = require("@quantbot/utils");
const normalize_1 = require("./normalize");
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
function parseJsonExport(filePath, chatId) {
    utils_1.logger.info('Parsing Telegram JSON export', { filePath });
    if (!fs.existsSync(filePath)) {
        throw new utils_1.NotFoundError('File', filePath);
    }
    const fileContent = fs.readFileSync(filePath, 'utf8');
    let exportData;
    try {
        exportData = JSON.parse(fileContent);
    }
    catch (error) {
        throw new utils_1.ValidationError(`Invalid JSON in file ${filePath}: ${error instanceof Error ? error.message : String(error)}`, { filePath, error: error instanceof Error ? error.message : String(error) });
    }
    // Extract chat ID from export or use provided
    const resolvedChatId = chatId || extractChatId(exportData, filePath);
    // Extract messages array - type guard for exportData
    if (typeof exportData !== 'object' || exportData === null) {
        throw new utils_1.ValidationError(`Expected object in export file ${filePath}`, { filePath });
    }
    const data = exportData;
    const rawMessages = data.messages || [];
    if (!Array.isArray(rawMessages)) {
        throw new utils_1.ValidationError(`Expected messages array in export file ${filePath}`, {
            filePath,
            dataType: typeof data.messages,
        });
    }
    utils_1.logger.info('Found raw messages', { count: rawMessages.length, chatId: resolvedChatId });
    const normalized = [];
    const quarantined = [];
    // Process each message: raw -> normalize
    for (const rawMessage of rawMessages) {
        const result = (0, normalize_1.normalizeTelegramMessage)(rawMessage, resolvedChatId);
        if (result.ok) {
            normalized.push(result.value);
        }
        else {
            // TypeScript now knows result is NormalizeErr
            quarantined.push({
                error: result.error,
                raw: result.raw,
            });
        }
    }
    utils_1.logger.info('Parsed Telegram JSON export', {
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
function extractChatId(exportData, filePath) {
    // Type guard for export data
    if (typeof exportData !== 'object' || exportData === null) {
        return path.basename(filePath, path.extname(filePath));
    }
    const data = exportData;
    // Try to get from export data
    if (data.name && typeof data.name === 'string') {
        // Use chat name as identifier
        return data.name.toLowerCase().replace(/\s+/g, '_');
    }
    if (data.id !== null && data.id !== undefined) {
        return String(data.id);
    }
    // Extract from file path (e.g., "messages/brook7/messages.json" -> "brook7")
    const pathMatch = filePath.match(/messages[/\\]([^/\\]+)[/\\]/);
    if (pathMatch) {
        return pathMatch[1];
    }
    // Fallback to filename without extension
    const fileName = filePath.split(/[/\\]/).pop() || 'unknown';
    return fileName.replace(/\.json$/, '');
}
//# sourceMappingURL=TelegramJsonExportParser.js.map