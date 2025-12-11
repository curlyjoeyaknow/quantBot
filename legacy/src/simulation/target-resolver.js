"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DefaultTargetResolver = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const luxon_1 = require("luxon");
const sync_1 = require("csv-parse/sync");
class DefaultTargetResolver {
    async resolve(scenario) {
        const selector = scenario.data;
        switch (selector.kind) {
            case 'mint':
                return [this.fromMint(selector)];
            case 'file':
                return this.fromFile(selector);
            case 'caller':
                throw new Error('Caller-based data selection is not yet implemented');
            case 'dataset':
                throw new Error('Dataset-based data selection is not yet implemented');
            default:
                throw new Error(`Unsupported data selector ${selector.kind}`);
        }
    }
    fromMint(selector) {
        const startTime = luxon_1.DateTime.fromISO(selector.start, { zone: 'utc' });
        if (!startTime.isValid) {
            throw new Error(`Invalid ISO timestamp for mint selector: ${selector.start}`);
        }
        const endTime = selector.end
            ? luxon_1.DateTime.fromISO(selector.end, { zone: 'utc' })
            : startTime.plus({ hours: selector.durationHours ?? 24 });
        if (!endTime.isValid) {
            throw new Error(`Invalid ISO timestamp for mint selector end: ${selector.end}`);
        }
        return {
            mint: selector.mint,
            chain: selector.chain ?? 'solana',
            startTime,
            endTime,
            metadata: { kind: 'mint' },
        };
    }
    async fromFile(selector) {
        const absolutePath = path_1.default.isAbsolute(selector.path)
            ? selector.path
            : path_1.default.join(process.cwd(), selector.path);
        const content = await fs_1.promises.readFile(absolutePath, 'utf-8');
        const records = selector.format === 'json'
            ? this.parseJson(content)
            : this.parseCsv(content);
        const targets = [];
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
            if (selector.filter && !this.matchesFilter(record, selector.filter)) {
                continue;
            }
            const mint = (record[selector.mintField] || '').trim();
            if (!mint) {
                continue;
            }
            let chain = selector.chainField
                ? (record[selector.chainField] || 'solana').trim().toLowerCase()
                : 'solana';
            // Smart chain detection: if message mentions a chain, use that instead of CSV value
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
                // Try to infer from URL
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
            const timestampRaw = record[selector.timestampField];
            if (!timestampRaw) {
                continue;
            }
            const baseTime = this.parseTimestamp(timestampRaw);
            if (!baseTime) {
                continue;
            }
            const startTime = baseTime.plus({ minutes: selector.startOffsetMinutes ?? 0 });
            const endTime = startTime.plus({ hours: selector.durationHours });
            // Extract token metadata from CSV record, or parse from message text if missing
            let tokenSymbol = (record.tokenSymbol || record.symbol || '').trim();
            let tokenName = (record.tokenName || record.name || '').trim();
            const caller = (record.caller || record.creator || record.sender || '').trim();
            // If metadata is missing, try to extract from message text (Rick/Phanes bot format)
            const messageText = (record.message || record.text || '');
            if ((!tokenSymbol || !tokenName) && messageText) {
                // Extract symbol from ($SYMBOL) or $SYMBOL pattern
                if (!tokenSymbol) {
                    const symbolMatch = messageText.match(/\$([A-Z0-9]+)/);
                    if (symbolMatch) {
                        tokenSymbol = symbolMatch[1];
                    }
                }
                // Extract name - look for pattern like "Token Name ($SYMBOL)" or "Token Name ["
                // Phanes format: "🟣 Token Name ($SYMBOL)" or "💊 Token Name ($SYMBOL)"
                // Rick format: "🐶 Token Name [100K/10%] $SYMBOL"
                if (!tokenName) {
                    const nameMatch = messageText.match(/(?:🟣|🐶|🟢|🔷|💊)\s*([^($\[]+?)(?:\s*\(|\s*\[|\s*\$)/);
                    if (nameMatch) {
                        tokenName = nameMatch[1].trim();
                    }
                    else {
                        // Fallback: look for token name before parentheses or brackets
                        const fallbackMatch = messageText.match(/^([A-Za-z0-9\s]+?)(?:\s*\(|\s*\[|\s*\$)/);
                        if (fallbackMatch) {
                            tokenName = fallbackMatch[1].trim();
                        }
                    }
                }
            }
            targets.push({
                mint,
                chain,
                startTime,
                endTime,
                metadata: {
                    kind: 'file',
                    source: selector.path,
                    tokenSymbol: tokenSymbol || undefined,
                    tokenName: tokenName || undefined,
                    caller: caller || undefined,
                },
            });
        }
        return targets;
    }
    parseCsv(content) {
        return (0, sync_1.parse)(content, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
        });
    }
    parseJson(content) {
        const data = JSON.parse(content);
        if (Array.isArray(data)) {
            return data;
        }
        if (Array.isArray(data.records)) {
            return data.records;
        }
        throw new Error('JSON data selection files must contain an array or { records: [] }');
    }
    matchesFilter(record, filter) {
        return Object.entries(filter).every(([key, expected]) => {
            if (!(key in record))
                return false;
            const actual = record[key];
            if (Array.isArray(expected)) {
                return expected.map(String).includes(actual);
            }
            return actual === String(expected);
        });
    }
    parseTimestamp(value) {
        if (!value)
            return null;
        if (/^\d+$/.test(value)) {
            const millis = Number(value);
            return luxon_1.DateTime.fromMillis(millis, { zone: 'utc' });
        }
        const iso = luxon_1.DateTime.fromISO(value, { zone: 'utc' });
        if (iso.isValid) {
            return iso;
        }
        const fromRFC = luxon_1.DateTime.fromRFC2822(value, { zone: 'utc' });
        return fromRFC.isValid ? fromRFC : null;
    }
}
exports.DefaultTargetResolver = DefaultTargetResolver;
//# sourceMappingURL=target-resolver.js.map