#!/usr/bin/env ts-node
"use strict";
/**
 * Test Chat Extraction Engine
 *
 * Tests the unified chat extraction engine by:
 * 1. Parsing the most recent messages HTML file
 * 2. Extracting tokens and metadata using the engine
 * 3. Attempting to fetch OHLCV candles for each extracted token
 * 4. Reporting success rate and metadata extraction quality
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
const chat_extraction_engine_1 = require("../src/services/chat-extraction-engine");
const ohlcv_engine_1 = require("../src/services/ohlcv-engine");
const logger_1 = require("../src/utils/logger");
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
 * Find the most recent messages file
 */
function findMostRecentMessagesFile() {
    const messagesDir = path.join(process.cwd(), 'data', 'raw', 'messages');
    if (!fs.existsSync(messagesDir)) {
        return null;
    }
    // Find all HTML files recursively
    const htmlFiles = [];
    function findFiles(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                findFiles(fullPath);
            }
            else if (entry.isFile() && entry.name.endsWith('.html')) {
                htmlFiles.push(fullPath);
            }
        }
    }
    findFiles(messagesDir);
    if (htmlFiles.length === 0) {
        return null;
    }
    // Sort by modification time (most recent first)
    htmlFiles.sort((a, b) => {
        const statA = fs.statSync(a);
        const statB = fs.statSync(b);
        return statB.mtime.getTime() - statA.mtime.getTime();
    });
    return htmlFiles[0];
}
async function main() {
    console.log(`\n${'='.repeat(80)}`);
    console.log('🧪 TESTING CHAT EXTRACTION ENGINE');
    console.log(`${'='.repeat(80)}\n`);
    // Find most recent messages file
    const messagesFile = findMostRecentMessagesFile();
    if (!messagesFile) {
        console.error('❌ No messages HTML files found in data/raw/messages');
        process.exit(1);
    }
    console.log(`📂 Using messages file: ${path.basename(messagesFile)}`);
    console.log(`📅 File modified: ${fs.statSync(messagesFile).mtime.toISOString()}\n`);
    // Parse messages
    console.log('📖 Parsing messages...');
    const messages = parseMessagesFile(messagesFile);
    console.log(`✅ Parsed ${messages.length} messages\n`);
    // Initialize engines
    const extractionEngine = (0, chat_extraction_engine_1.getChatExtractionEngine)();
    const ohlcvEngine = (0, ohlcv_engine_1.getOHLCVEngine)();
    await ohlcvEngine.initialize();
    console.log('🔍 Extracting tokens from messages...\n');
    const testResults = [];
    const uniqueTokens = new Map();
    // Process messages in batches (original + next 2 bot messages)
    for (let i = 0; i < messages.length; i++) {
        const original = messages[i];
        // Skip if original is a bot
        if (extractionEngine.isBot(original.sender)) {
            continue;
        }
        // Find next 2 bot messages
        const botMessages = [];
        for (let j = i + 1; j < Math.min(messages.length, i + 10); j++) {
            if (extractionEngine.isBot(messages[j].sender)) {
                botMessages.push(messages[j]);
                if (botMessages.length >= 2) {
                    break;
                }
            }
        }
        // Extract tokens
        try {
            const extracted = await extractionEngine.extract(original, botMessages, {
                botMessageLookahead: 2,
                extractMetadata: true
            });
            for (const token of extracted) {
                const key = `${token.mint.toLowerCase()}_${token.chain}`;
                // Skip if we've already processed this token
                if (uniqueTokens.has(key)) {
                    continue;
                }
                // Try to fetch candles
                const startTime = luxon_1.DateTime.fromISO('2025-11-01');
                const endTime = luxon_1.DateTime.utc();
                try {
                    const candleResult = await ohlcvEngine.fetch(token.mint, startTime, endTime, token.chain, {
                        cacheOnly: false,
                        ensureIngestion: true,
                        interval: '5m'
                    });
                    const result = {
                        token: token.mint,
                        chain: token.chain,
                        source: token.source,
                        confidence: token.confidence,
                        metadata: token.metadata,
                        candlesFetched: candleResult.candles.length > 0,
                        candleCount: candleResult.candles.length
                    };
                    testResults.push(result);
                    uniqueTokens.set(key, result);
                    const status = result.candlesFetched ? '✅' : '❌';
                    const metadata = result.metadata ?
                        ` | ${result.metadata.symbol || 'N/A'} | ${result.metadata.name || 'N/A'}` :
                        ' | No metadata';
                    console.log(`  ${status} ${token.mint.substring(0, 30)}... | ${result.candleCount} candles | ` +
                        `Source: ${result.source} (${(result.confidence * 100).toFixed(0)}%)${metadata}`);
                }
                catch (error) {
                    const result = {
                        token: token.mint,
                        chain: token.chain,
                        source: token.source,
                        confidence: token.confidence,
                        metadata: token.metadata,
                        candlesFetched: false,
                        candleCount: 0,
                        error: error.message || String(error)
                    };
                    testResults.push(result);
                    uniqueTokens.set(key, result);
                    console.log(`  ❌ ${token.mint.substring(0, 30)}... | Error: ${result.error}`);
                }
            }
        }
        catch (error) {
            logger_1.logger.warn('Error extracting from message', { error: error.message, sender: original.sender });
        }
    }
    // Summary
    console.log(`\n${'='.repeat(80)}`);
    console.log('📊 TEST RESULTS SUMMARY');
    console.log(`${'='.repeat(80)}\n`);
    const total = testResults.length;
    const candlesFetched = testResults.filter(r => r.candlesFetched).length;
    const successRate = total > 0 ? (candlesFetched / total) * 100 : 0;
    const withMetadata = testResults.filter(r => r.metadata && (r.metadata.name || r.metadata.symbol)).length;
    const metadataRate = total > 0 ? (withMetadata / total) * 100 : 0;
    const fromBot = testResults.filter(r => r.source === 'bot' || r.source === 'validated').length;
    const fromOriginal = testResults.filter(r => r.source === 'original').length;
    console.log(`Total tokens extracted: ${total}`);
    console.log(`✅ Candles fetched successfully: ${candlesFetched} (${successRate.toFixed(1)}%)`);
    console.log(`📊 With metadata: ${withMetadata} (${metadataRate.toFixed(1)}%)`);
    console.log(`\nSource breakdown:`);
    console.log(`  📦 From bot messages: ${fromBot}`);
    console.log(`  💬 From original messages: ${fromOriginal}`);
    console.log(`  ✅ Validated (bot corrected): ${testResults.filter(r => r.source === 'validated').length}\n`);
    // Detailed breakdown
    if (candlesFetched < total * 0.95) {
        console.log(`\n⚠️  SUCCESS RATE BELOW 95% TARGET`);
        console.log(`   Target: 95%+ (${Math.ceil(total * 0.95)} tokens)`);
        console.log(`   Actual: ${successRate.toFixed(1)}% (${candlesFetched} tokens)\n`);
        const failed = testResults.filter(r => !r.candlesFetched);
        console.log(`Failed tokens (${failed.length}):`);
        for (const result of failed.slice(0, 10)) {
            console.log(`  - ${result.token.substring(0, 40)}... (${result.chain}) - ${result.error || 'No candles'}`);
        }
        if (failed.length > 10) {
            console.log(`  ... and ${failed.length - 10} more`);
        }
    }
    else {
        console.log(`\n✅ SUCCESS RATE MEETS 95%+ TARGET! 🎉\n`);
    }
    // Save results
    const outputFile = path.join(process.cwd(), 'data', 'exports', 'chat-extraction-test-results.json');
    const outputDir = path.dirname(outputFile);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(outputFile, JSON.stringify({
        testDate: new Date().toISOString(),
        messagesFile: path.basename(messagesFile),
        totalMessages: messages.length,
        results: testResults,
        summary: {
            total,
            candlesFetched,
            successRate,
            withMetadata,
            metadataRate,
            fromBot,
            fromOriginal
        }
    }, null, 2));
    console.log(`\n💾 Results saved to: ${outputFile}`);
    console.log(`\n✅ Test complete!\n`);
}
if (require.main === module) {
    main().catch(console.error);
}
//# sourceMappingURL=test-chat-extraction-engine.js.map