#!/usr/bin/env ts-node
"use strict";
/**
 * Extract All Calls from September Onwards
 *
 * Uses the unified chat extraction engine and OHLCV engine to:
 * 1. Process all message files from September 2025 onwards
 * 2. Extract tokens and metadata using the chat extraction engine
 * 3. Deduplicate tokens (same mint + chain)
 * 4. Fetch 5m OHLCV candles end-to-end for each unique token
 * 5. Report progress and results
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
require("dotenv/config");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const luxon_1 = require("luxon");
const services_1 = require("@quantbot/services");
const services_2 = require("@quantbot/services");
const utils_1 = require("@quantbot/utils");
/**
 * Parse HTML messages file and extract messages
 */
function parseMessagesFile(filePath) {
    const htmlContent = fs.readFileSync(filePath, 'utf8');
    const messages = [];
    // Parse HTML to find messages
    const messageRegex = /<div class="message[^"]*"[^>]*id="message[^"]*">([\s\S]*?)(?=<div class="message|$)/g;
    let match;
    while ((match = messageRegex.exec(htmlContent)) !== null) {
        const messageHtml = match[1];
        // Extract sender
        const senderMatch = messageHtml.match(/<div class="from_name">\s*([^<]+)\s*<\/div>/);
        const sender = senderMatch ? senderMatch[1].trim() : '';
        // Extract timestamp
        const timestampMatch = messageHtml.match(/title="([^"]+)"/);
        const timestampStr = timestampMatch ? timestampMatch[1] : '';
        // Extract text
        const textMatch = messageHtml.match(/<div class="text">([\s\S]*?)<\/div>/);
        const text = textMatch ? textMatch[1].replace(/<[^>]+>/g, ' ').trim() : '';
        if (sender && text) {
            let timestamp;
            try {
                timestamp = luxon_1.DateTime.fromISO(timestampStr);
                if (!timestamp.isValid) {
                    timestamp = luxon_1.DateTime.now();
                }
            }
            catch {
                timestamp = luxon_1.DateTime.now();
            }
            messages.push({
                sender,
                text,
                timestamp,
            });
        }
    }
    return messages;
}
/**
 * Find all message files from September 2025 onwards, sorted by date (newest first)
 */
function findAllMessageFiles() {
    const messagesDir = path.join(process.cwd(), 'data', 'raw', 'messages');
    const files = [];
    if (!fs.existsSync(messagesDir)) {
        return files;
    }
    function findFiles(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                findFiles(fullPath);
            }
            else if (entry.isFile() && entry.name.endsWith('.html')) {
                const stat = fs.statSync(fullPath);
                // Only include files from September 2025 onwards
                if (stat.mtime >= new Date('2025-09-01')) {
                    files.push({ path: fullPath, mtime: stat.mtime });
                }
            }
        }
    }
    findFiles(messagesDir);
    // Sort by modification time (newest first)
    files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    return files;
}
async function main() {
    console.log(`\n${'='.repeat(80)}`);
    console.log('📥 EXTRACTING ALL CALLS FROM SEPTEMBER 2025 ONWARDS');
    console.log(`${'='.repeat(80)}\n`);
    // Find all message files
    const messageFiles = findAllMessageFiles();
    console.log(`📂 Found ${messageFiles.length} message files from September 2025 onwards\n`);
    if (messageFiles.length === 0) {
        console.error('❌ No message files found');
        process.exit(1);
    }
    // Initialize engines
    const extractionEngine = (0, services_1.getChatExtractionEngine)();
    const ohlcvEngine = (0, services_2.getOHLCVEngine)();
    await ohlcvEngine.initialize();
    // Track all extracted tokens (deduplicated by mint + chain)
    const tokenMap = new Map();
    const startTime = luxon_1.DateTime.fromISO('2025-09-01');
    const endTime = luxon_1.DateTime.utc();
    console.log('🔍 Processing message files and extracting tokens...\n');
    // Process each message file
    for (let fileIdx = 0; fileIdx < messageFiles.length; fileIdx++) {
        const fileInfo = messageFiles[fileIdx];
        const fileName = path.relative(process.cwd(), fileInfo.path);
        console.log(`[${fileIdx + 1}/${messageFiles.length}] Processing: ${fileName}`);
        try {
            const messages = parseMessagesFile(fileInfo.path);
            console.log(`  📖 Parsed ${messages.length} messages`);
            let tokensFromFile = 0;
            // Use the engine's batchExtract method for efficient processing
            try {
                const extractedMap = await extractionEngine.batchExtract(messages, {
                    botMessageLookahead: 2,
                    extractMetadata: true
                });
                // Process all extracted tokens
                // Create a map of message keys to their original messages for timestamp lookup
                const messageKeyToMessage = new Map();
                for (let i = 0; i < messages.length; i++) {
                    const msg = messages[i];
                    if (!extractionEngine.isBot(msg.sender)) {
                        const msgKey = typeof msg.timestamp === 'string'
                            ? `${msg.sender}_${msg.timestamp}`
                            : `${msg.sender}_${msg.timestamp.toISO()}`;
                        messageKeyToMessage.set(msgKey, msg);
                    }
                }
                for (const [messageKey, extracted] of extractedMap.entries()) {
                    // Get the original message for timestamp
                    const originalMsg = messageKeyToMessage.get(messageKey);
                    const timestamp = originalMsg
                        ? (typeof originalMsg.timestamp === 'string'
                            ? luxon_1.DateTime.fromISO(originalMsg.timestamp) || luxon_1.DateTime.now()
                            : originalMsg.timestamp)
                        : luxon_1.DateTime.now();
                    for (const token of extracted) {
                        const key = `${token.mint.toLowerCase()}_${token.chain}`;
                        // Deduplicate: keep the first occurrence (earliest timestamp)
                        if (!tokenMap.has(key)) {
                            tokenMap.set(key, {
                                mint: token.mint,
                                chain: token.chain,
                                source: token.source,
                                confidence: token.confidence,
                                metadata: token.metadata,
                                firstSeen: timestamp,
                                messageFile: fileName
                            });
                            tokensFromFile++;
                        }
                    }
                }
            }
            catch (error) {
                utils_1.logger.error('Error batch extracting from file', {
                    error: error.message,
                    file: fileName
                });
            }
            console.log(`  ✅ Extracted ${tokensFromFile} new tokens (${tokenMap.size} total unique)\n`);
        }
        catch (error) {
            utils_1.logger.error('Error processing message file', {
                file: fileName,
                error: error.message
            });
            console.log(`  ❌ Error: ${error.message}\n`);
        }
    }
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 EXTRACTION SUMMARY`);
    console.log(`${'='.repeat(80)}\n`);
    console.log(`Total unique tokens extracted: ${tokenMap.size}`);
    const byChain = new Map();
    const bySource = new Map();
    for (const token of tokenMap.values()) {
        byChain.set(token.chain, (byChain.get(token.chain) || 0) + 1);
        bySource.set(token.source, (bySource.get(token.source) || 0) + 1);
    }
    console.log(`\nBy chain:`);
    for (const [chain, count] of Array.from(byChain.entries()).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${chain}: ${count}`);
    }
    console.log(`\nBy source:`);
    for (const [source, count] of Array.from(bySource.entries()).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${source}: ${count}`);
    }
    console.log(`\n${'='.repeat(80)}`);
    console.log('🕯️  FETCHING 5M OHLCV CANDLES');
    console.log(`${'='.repeat(80)}\n`);
    const results = [];
    const tokens = Array.from(tokenMap.values());
    // Sort by chain (Solana first) for better progress visibility
    tokens.sort((a, b) => {
        if (a.chain === 'solana' && b.chain !== 'solana')
            return -1;
        if (a.chain !== 'solana' && b.chain === 'solana')
            return 1;
        return 0;
    });
    // Process in batches to avoid overwhelming the API
    const BATCH_SIZE = 50;
    const batches = [];
    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
        batches.push(tokens.slice(i, i + BATCH_SIZE));
    }
    console.log(`📦 Processing ${tokens.length} tokens in ${batches.length} batches of ${BATCH_SIZE}\n`);
    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
        const batch = batches[batchIdx];
        console.log(`\n🔄 Batch ${batchIdx + 1}/${batches.length} (${batch.length} tokens)...\n`);
        for (let i = 0; i < batch.length; i++) {
            const token = batch[i];
            const globalIdx = batchIdx * BATCH_SIZE + i + 1;
            const progress = `[${globalIdx}/${tokens.length}]`;
            try {
                const candleResult = await ohlcvEngine.fetch(token.mint, startTime, endTime, token.chain, {
                    cacheOnly: false,
                    ensureIngestion: true,
                    interval: '5m'
                });
                const result = {
                    token: token.mint,
                    chain: token.chain,
                    candlesFetched: candleResult.candles.length > 0,
                    candleCount: candleResult.candles.length
                };
                results.push(result);
                const status = result.candlesFetched ? '✅' : '❌';
                const metadata = token.metadata ?
                    ` | ${token.metadata.symbol || 'N/A'} | ${token.metadata.name || 'N/A'}` :
                    ' | No metadata';
                console.log(`  ${progress} ${status} ${token.mint.substring(0, 30)}... | ` +
                    `${result.candleCount} candles | ${token.chain}${metadata}`);
            }
            catch (error) {
                const result = {
                    token: token.mint,
                    chain: token.chain,
                    candlesFetched: false,
                    candleCount: 0,
                    error: error.message || String(error)
                };
                results.push(result);
                console.log(`  ${progress} ❌ ${token.mint.substring(0, 30)}... | Error: ${result.error}`);
            }
            // Small delay between requests to avoid rate limiting
            if (i < batch.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        // Save progress after each batch (including partial results)
        const progressFile = path.join(process.cwd(), 'data', 'exports', 'september-onwards-extraction-progress.json');
        const progressDir = path.dirname(progressFile);
        if (!fs.existsSync(progressDir)) {
            fs.mkdirSync(progressDir, { recursive: true });
        }
        // Save both progress and full results incrementally
        fs.writeFileSync(progressFile, JSON.stringify({
            lastUpdate: new Date().toISOString(),
            batchesCompleted: batchIdx + 1,
            totalBatches: batches.length,
            tokensProcessed: results.length,
            totalTokens: tokens.length,
            results: results
        }, null, 2));
        // Also save full results incrementally (so we don't lose data if script crashes)
        const fullResultsFile = path.join(process.cwd(), 'data', 'exports', 'september-onwards-extraction-results.json');
        fs.writeFileSync(fullResultsFile, JSON.stringify({
            extractionDate: new Date().toISOString(),
            startDate: startTime.toISO(),
            endDate: endTime.toISO(),
            messageFilesProcessed: messageFiles.length,
            totalTokensExtracted: tokenMap.size,
            tokens: Array.from(tokenMap.values()).map(t => ({
                mint: t.mint,
                chain: t.chain,
                source: t.source,
                confidence: t.confidence,
                metadata: t.metadata,
                firstSeen: typeof t.firstSeen === 'string' ? t.firstSeen : t.firstSeen.toISO(),
                messageFile: t.messageFile
            })),
            results: results,
            summary: {
                total: results.length,
                candlesFetched: results.filter(r => r.candlesFetched).length,
                successRate: results.length > 0 ? (results.filter(r => r.candlesFetched).length / results.length) * 100 : 0,
                solanaTotal: results.filter(r => r.chain === 'solana').length,
                solanaFetched: results.filter(r => r.chain === 'solana' && r.candlesFetched).length,
                solanaSuccessRate: results.filter(r => r.chain === 'solana').length > 0
                    ? (results.filter(r => r.chain === 'solana' && r.candlesFetched).length / results.filter(r => r.chain === 'solana').length) * 100
                    : 0
            },
            inProgress: batchIdx < batches.length - 1
        }, null, 2));
        console.log(`\n💾 Progress saved (batch ${batchIdx + 1}/${batches.length}). ClickHouse data ingested incrementally.`);
        // Longer delay between batches
        if (batchIdx < batches.length - 1) {
            console.log(`⏳ Waiting 2 seconds before next batch...\n`);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    // Final summary
    console.log(`\n${'='.repeat(80)}`);
    console.log('📊 FINAL RESULTS SUMMARY');
    console.log(`${'='.repeat(80)}\n`);
    const total = results.length;
    const candlesFetched = results.filter(r => r.candlesFetched).length;
    const successRate = total > 0 ? (candlesFetched / total) * 100 : 0;
    const solanaResults = results.filter(r => r.chain === 'solana');
    const solanaFetched = solanaResults.filter(r => r.candlesFetched).length;
    const solanaSuccessRate = solanaResults.length > 0 ?
        (solanaFetched / solanaResults.length) * 100 : 0;
    console.log(`Total tokens processed: ${total}`);
    console.log(`✅ Candles fetched successfully: ${candlesFetched} (${successRate.toFixed(1)}%)`);
    console.log(`\nSolana tokens:`);
    console.log(`  Total: ${solanaResults.length}`);
    console.log(`  ✅ Fetched: ${solanaFetched} (${solanaSuccessRate.toFixed(1)}%)`);
    if (candlesFetched < total) {
        const failed = results.filter(r => !r.candlesFetched);
        console.log(`\n⚠️  Failed tokens (${failed.length}):`);
        for (const result of failed.slice(0, 10)) {
            console.log(`  - ${result.token.substring(0, 40)}... (${result.chain}) - ${result.error || 'No candles'}`);
        }
        if (failed.length > 10) {
            console.log(`  ... and ${failed.length - 10} more`);
        }
    }
    // Final results file (already saved incrementally, just mark as complete)
    const outputFile = path.join(process.cwd(), 'data', 'exports', 'september-onwards-extraction-results.json');
    if (fs.existsSync(outputFile)) {
        const existing = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
        existing.inProgress = false;
        existing.summary = {
            total,
            candlesFetched,
            successRate,
            solanaTotal: solanaResults.length,
            solanaFetched,
            solanaSuccessRate
        };
        fs.writeFileSync(outputFile, JSON.stringify(existing, null, 2));
    }
    else {
        // If file doesn't exist (shouldn't happen), create it
        const outputDir = path.dirname(outputFile);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        fs.writeFileSync(outputFile, JSON.stringify({
            extractionDate: new Date().toISOString(),
            startDate: startTime.toISO(),
            endDate: endTime.toISO(),
            messageFilesProcessed: messageFiles.length,
            totalTokensExtracted: tokenMap.size,
            tokens: Array.from(tokenMap.values()).map(t => ({
                mint: t.mint,
                chain: t.chain,
                source: t.source,
                confidence: t.confidence,
                metadata: t.metadata,
                firstSeen: typeof t.firstSeen === 'string' ? t.firstSeen : t.firstSeen.toISO(),
                messageFile: t.messageFile
            })),
            results: results,
            summary: {
                total,
                candlesFetched,
                successRate,
                solanaTotal: solanaResults.length,
                solanaFetched,
                solanaSuccessRate
            },
            inProgress: false
        }, null, 2));
    }
    console.log(`\n💾 Final results saved to: ${outputFile}`);
    console.log(`\n✅ Extraction complete!\n`);
}
if (require.main === module) {
    main().catch(console.error);
}
//# sourceMappingURL=extract-all-calls-september-onwards.js.map