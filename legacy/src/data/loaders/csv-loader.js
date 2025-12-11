"use strict";
/**
 * CSV Data Loader
 *
 * Loads trading call data from CSV files
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CsvDataLoader = void 0;
const fs_1 = require("fs");
const csv_parse_1 = require("csv-parse");
const luxon_1 = require("luxon");
const path_1 = __importDefault(require("path"));
class CsvDataLoader {
    constructor() {
        this.name = 'csv-loader';
    }
    async load(params) {
        const csvParams = params;
        if (!csvParams.path) {
            throw new Error('CSV loader requires a path parameter');
        }
        const filePath = path_1.default.isAbsolute(csvParams.path)
            ? csvParams.path
            : path_1.default.join(process.cwd(), csvParams.path);
        // Read CSV file
        const csvContent = await fs_1.promises.readFile(filePath, 'utf-8');
        // Parse CSV
        const records = await new Promise((resolve, reject) => {
            (0, csv_parse_1.parse)(csvContent, {
                columns: true,
                skip_empty_lines: true,
                relax_column_count: true,
            }, (err, records) => {
                if (err)
                    reject(err);
                else
                    resolve(records);
            });
        });
        // Transform to LoadResult format
        const results = [];
        const startOffsetMinutes = csvParams.startOffsetMinutes ?? 0;
        const durationHours = csvParams.durationHours ?? 24 * 60; // Default 60 days
        for (const record of records) {
            // Filter out bot messages (presale alerts, etc.)
            const sender = (record.sender || record.caller || '').toLowerCase();
            const message = (record.message || record.text || '').toLowerCase();
            const botPatterns = [
                'wen presale',
                'wenpresale',
                'presale',
                'gempad',
                'rick',
                'phanes',
                'bot',
            ];
            const isBotMessage = botPatterns.some(pattern => sender.includes(pattern) || message.includes(pattern));
            if (isBotMessage) {
                continue; // Skip bot messages
            }
            // Extract required fields - trim whitespace that might be introduced during CSV parsing
            const mint = (record[csvParams.mintField] || record.tokenAddress || record.mint || '').trim();
            let chain = (record[csvParams.chainField] || record.chain || 'solana').trim().toLowerCase();
            const timestampStr = (record[csvParams.timestampField] || record.timestamp || record.alertTime || '').trim();
            if (!mint || !timestampStr) {
                continue; // Skip invalid records
            }
            // Smart chain detection: if message mentions a chain, use that instead of CSV value
            // This fixes cases where extraction script incorrectly labeled all 0x addresses as 'bsc'
            if (message.includes('base detected') || message.includes('on base') || message.includes('network=base')) {
                chain = 'base';
            }
            else if (message.includes('ethereum') || message.includes('eth network')) {
                chain = 'ethereum';
            }
            else if (message.includes('bsc') || message.includes('binance')) {
                chain = 'bsc';
            }
            else if (mint.startsWith('0x') && chain === 'bsc') {
                // If it's an EVM address but chain is 'bsc' (default from extraction), 
                // try to infer from URL or other context
                const urlMatch = message.match(/network=(\w+)/i);
                if (urlMatch) {
                    const network = urlMatch[1].toLowerCase();
                    if (['base', 'ethereum', 'bsc', 'arbitrum', 'polygon'].includes(network)) {
                        chain = network;
                    }
                }
            }
            // Only include tokens on supported chains: BSC, Ethereum, or Solana
            const supportedChains = ['bsc', 'ethereum', 'solana'];
            if (!supportedChains.includes(chain)) {
                continue; // Skip tokens on other chains (Base, Arbitrum, Polygon, etc.)
            }
            // Parse timestamp
            let timestamp;
            try {
                timestamp = luxon_1.DateTime.fromISO(timestampStr);
                if (!timestamp.isValid) {
                    timestamp = luxon_1.DateTime.fromJSDate(new Date(timestampStr));
                }
                if (!timestamp.isValid) {
                    continue; // Skip invalid timestamps
                }
            }
            catch {
                continue; // Skip records with unparseable timestamps
            }
            // Apply start offset
            if (startOffsetMinutes > 0) {
                timestamp = timestamp.plus({ minutes: startOffsetMinutes });
            }
            // Apply filters if provided
            if (csvParams.filter) {
                let matches = true;
                for (const [key, value] of Object.entries(csvParams.filter)) {
                    if (record[key] !== value) {
                        matches = false;
                        break;
                    }
                }
                if (!matches) {
                    continue;
                }
            }
            // Build result
            const result = {
                mint,
                chain,
                timestamp,
                tokenAddress: mint,
                tokenSymbol: record.tokenSymbol || record.symbol,
                tokenName: record.tokenName || record.name,
                caller: record.caller || record.creator || record.sender,
                // Include all original fields for flexibility
                ...record,
            };
            // Add computed fields
            result.endTime = timestamp.plus({ hours: durationHours });
            results.push(result);
        }
        // Apply limit and offset if provided
        let filtered = results;
        if (csvParams.offset) {
            filtered = filtered.slice(csvParams.offset);
        }
        if (csvParams.limit) {
            filtered = filtered.slice(0, csvParams.limit);
        }
        return filtered;
    }
    canLoad(source) {
        return source === 'csv' || source.endsWith('.csv');
    }
}
exports.CsvDataLoader = CsvDataLoader;
//# sourceMappingURL=csv-loader.js.map