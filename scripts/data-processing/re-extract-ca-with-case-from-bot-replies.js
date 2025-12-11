#!/usr/bin/env ts-node
"use strict";
/**
 * Re-extract CA (Caller Alerts) from Chat Messages with Correct Case from Bot Replies
 *
 * This script:
 * 1. Reads chat message HTML files
 * 2. Uses ChatExtractionEngine to extract tokens from bot replies (which preserve correct case)
 * 3. Updates caller_alerts database with correct case addresses
 * 4. Preserves existing metadata but fixes address case
 *
 * This fixes the issue where addresses were stored in lowercase, but Solana addresses are case-sensitive.
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const luxon_1 = require("luxon");
const sqlite3 = __importStar(require("sqlite3"));
const util_1 = require("util");
const axios_1 = __importDefault(require("axios"));
const chat_extraction_engine_1 = require("../../src/services/chat-extraction-engine");
const logger_1 = require("../../src/utils/logger");
const MESSAGES_DIR = path.join(process.cwd(), 'data/raw/messages');
const CALLER_ALERTS_DB = path.join(process.cwd(), 'data/caller_alerts.db');
/**
 * Parse HTML messages file and extract messages
 */
function parseMessagesFile(filePath) {
    const htmlContent = fs.readFileSync(filePath, 'utf8');
    const messages = [];
    // Parse HTML to find messages (Telegram export format)
    const messageRegex = /<div class="message[^"]*"[^>]*id="message[^"]*">([\s\S]*?)(?=<div class="message|$)/g;
    let match;
    while ((match = messageRegex.exec(htmlContent)) !== null) {
        const messageHtml = match[1];
        // Skip service messages (date headers, etc.)
        if (messageHtml.includes('class="message service"')) {
            continue;
        }
        // Extract sender (handle both single-line and multi-line formats)
        const senderMatch = messageHtml.match(/<div class="from_name">\s*([\s\S]*?)\s*<\/div>/);
        let sender = senderMatch ? senderMatch[1].trim() : '';
        // Clean up sender (remove any HTML tags that might be inside)
        sender = sender.replace(/<[^>]+>/g, '').trim();
        // Extract timestamp
        const timestampMatch = messageHtml.match(/title="([^"]+)"/);
        const timestampStr = timestampMatch ? timestampMatch[1] : '';
        // Extract text
        const textMatch = messageHtml.match(/<div class="text">([\s\S]*?)<\/div>/);
        let text = textMatch ? textMatch[1] : '';
        // Clean up HTML entities and tags
        if (text) {
            text = text
                .replace(/<[^>]+>/g, ' ')
                .replace(/&apos;/g, "'")
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&nbsp;/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        }
        // Only add messages with sender and text
        if (sender && text) {
            messages.push({
                sender,
                text,
                timestamp: timestampStr,
            });
        }
    }
    return messages;
}
/**
 * Get all message files recursively, only from folders named "brook"
 */
function getAllMessageFiles(dir) {
    const files = [];
    function walkDir(currentPath, isInBrookFolder = false) {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        // Check if current directory is named "brook" (case-insensitive)
        const currentDirName = path.basename(currentPath).toLowerCase();
        const isBrookFolder = currentDirName === 'brook' || isInBrookFolder;
        for (const entry of entries) {
            const fullPath = path.join(currentPath, entry.name);
            if (entry.isDirectory()) {
                // Continue walking, but track if we're in a brook folder
                walkDir(fullPath, isBrookFolder);
            }
            else if (entry.isFile() && (entry.name.endsWith('.html') || entry.name.endsWith('.htm'))) {
                // Only include files if we're in a brook folder or a subfolder of brook
                if (isBrookFolder) {
                    files.push(fullPath);
                }
            }
        }
    }
    walkDir(dir);
    return files;
}
/**
 * Initialize caller_alerts database
 */
async function initDatabase() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(CALLER_ALERTS_DB, (err) => {
            if (err) {
                logger_1.logger.error('Error opening database', err);
                return reject(err);
            }
        });
        const run = (0, util_1.promisify)(db.run.bind(db));
        // Create token_metadata table first
        run(`
      CREATE TABLE IF NOT EXISTS token_metadata (
        mint TEXT PRIMARY KEY,
        chain TEXT NOT NULL DEFAULT 'solana',
        token_name TEXT,
        token_symbol TEXT,
        decimals INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).then(() => {
            // Create caller_alerts table (references token_metadata via mint)
            return run(`
        CREATE TABLE IF NOT EXISTS caller_alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          caller_name TEXT NOT NULL,
          token_address TEXT NOT NULL,
          chain TEXT NOT NULL DEFAULT 'solana',
          alert_timestamp DATETIME NOT NULL,
          alert_message TEXT,
          price_at_alert REAL,
          market_cap_at_alert REAL,
          volume_at_alert REAL,
          is_duplicate INTEGER DEFAULT 0,
          original_call_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(caller_name, token_address, alert_timestamp),
          FOREIGN KEY (token_address) REFERENCES token_metadata(mint)
        )
      `);
        }).then(() => {
            // Add columns if they don't exist (for existing databases)
            return run(`ALTER TABLE caller_alerts ADD COLUMN is_duplicate INTEGER DEFAULT 0`).catch(() => {
                // Column already exists, ignore
            });
        }).then(() => {
            return run(`ALTER TABLE caller_alerts ADD COLUMN original_call_id INTEGER`).catch(() => {
                // Column already exists, ignore
            });
        }).then(() => {
            run(`CREATE INDEX IF NOT EXISTS idx_token_address ON caller_alerts(token_address)`);
            run(`CREATE INDEX IF NOT EXISTS idx_alert_timestamp ON caller_alerts(alert_timestamp)`);
            run(`CREATE INDEX IF NOT EXISTS idx_caller_timestamp ON caller_alerts(caller_name, alert_timestamp)`);
        }).then(() => {
            resolve(db);
        }).catch(reject);
    });
}
/**
 * Upsert token metadata to token_metadata table
 */
async function upsertTokenMetadata(db, mint, chain, tokenName, tokenSymbol, decimals) {
    return new Promise((resolve, reject) => {
        const query = `
      INSERT INTO token_metadata (mint, chain, token_name, token_symbol, decimals, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(mint) DO UPDATE SET
        token_name = COALESCE(?, token_name),
        token_symbol = COALESCE(?, token_symbol),
        decimals = COALESCE(?, decimals),
        updated_at = CURRENT_TIMESTAMP
    `;
        db.run(query, [
            mint,
            chain,
            tokenName || null,
            tokenSymbol || null,
            decimals || null,
            tokenName || null,
            tokenSymbol || null,
            decimals || null
        ], (err) => {
            if (err) {
                return reject(err);
            }
            resolve();
        });
    });
}
/**
 * Fetch token metadata from Birdeye API
 */
async function fetchTokenMetadata(tokenAddress, chain = 'solana', alertTimestamp) {
    const apiKey = process.env.BIRDEYE_API_KEY || process.env.BIRDEYE_API_KEY_1;
    if (!apiKey) {
        return null;
    }
    try {
        const response = await axios_1.default.get('https://public-api.birdeye.so/defi/v3/token/meta-data/single', {
            headers: {
                'X-API-KEY': apiKey,
                'accept': 'application/json',
                'x-chain': chain,
            },
            params: {
                address: tokenAddress,
            },
            timeout: 10000,
            validateStatus: (status) => status < 500,
        });
        if (response.status === 200 && response.data?.success && response.data?.data) {
            const data = response.data.data;
            return {
                name: data.name,
                symbol: data.symbol,
                price: data.price,
                marketCap: data.marketCap || data.mc,
                decimals: data.decimals,
            };
        }
    }
    catch (error) {
        logger_1.logger.debug('Failed to fetch token metadata from Birdeye', {
            token: tokenAddress.substring(0, 20),
            error: error.message,
        });
    }
    return null;
}
/**
 * Check if this is a duplicate call (same token, same caller, within 1 minute)
 * Returns the original call ID if duplicate, null otherwise
 */
async function checkForDuplicate(db, tokenAddress, callerName, alertTimestamp) {
    return new Promise((resolve, reject) => {
        // Check for duplicates: same token, same caller, within 1 minute
        const oneMinuteAgo = alertTimestamp.minus({ minutes: 1 });
        const oneMinuteLater = alertTimestamp.plus({ minutes: 1 });
        const oneMinuteAgoStr = oneMinuteAgo.toISO() || '';
        const oneMinuteLaterStr = oneMinuteLater.toISO() || '';
        if (!oneMinuteAgoStr || !oneMinuteLaterStr) {
            return resolve(null);
        }
        const duplicateQuery = `
      SELECT id, alert_timestamp FROM caller_alerts
      WHERE LOWER(token_address) = LOWER(?)
        AND caller_name = ?
        AND alert_timestamp >= ?
        AND alert_timestamp <= ?
        AND is_duplicate = 0
      ORDER BY alert_timestamp ASC
      LIMIT 1
    `;
        db.get(duplicateQuery, [
            tokenAddress,
            callerName,
            oneMinuteAgoStr,
            oneMinuteLaterStr
        ], (err, row) => {
            if (err) {
                return reject(err);
            }
            if (row) {
                // Check if more than 3 days apart - if so, treat as separate call
                const existingTimestamp = luxon_1.DateTime.fromISO(row.alert_timestamp);
                const daysDiff = Math.abs(alertTimestamp.diff(existingTimestamp, 'days').days);
                if (daysDiff > 3) {
                    return resolve(null); // More than 3 days apart, treat as separate
                }
                return resolve(row.id); // Duplicate found
            }
            resolve(null); // No duplicate
        });
    });
}
/**
 * Update or insert caller alert with correct case and metadata
 */
async function upsertCallerAlert(db, ca, callerName) {
    return new Promise((resolve, reject) => {
        // Check for duplicates first
        checkForDuplicate(db, ca.tokenAddress, callerName, ca.alertTimestamp).then(async (duplicateId) => {
            const isDuplicate = duplicateId !== null;
            // Fetch metadata from API if not available from bot messages
            let metadata = null;
            if (!ca.tokenName || !ca.tokenSymbol || !ca.priceAtAlert) {
                console.log(`    🌐 Fetching metadata from Birdeye API...`);
                metadata = await fetchTokenMetadata(ca.tokenAddress, ca.chain, ca.alertTimestamp);
                if (metadata) {
                    console.log(`    📊 Metadata: ${metadata.name || 'N/A'} (${metadata.symbol || 'N/A'}) - $${metadata.price || 'N/A'}`);
                }
                else {
                    console.log(`    ⚠️  No metadata found from API`);
                }
            }
            // Enhanced extraction from bot message text
            let finalTokenSymbol = ca.tokenSymbol || metadata?.symbol;
            let finalTokenName = ca.tokenName || metadata?.name;
            if (ca.botMessageText) {
                // Clean HTML tags first for better matching
                const cleanText = ca.botMessageText
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/&nbsp;/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                // Try multiple patterns for symbol extraction
                if (!finalTokenSymbol) {
                    // Pattern 1: $SYMBOL (most common)
                    const symbolMatch1 = cleanText.match(/\$([A-Z0-9]{2,15})\b/);
                    // Pattern 2: (SYMBOL) in parentheses
                    const symbolMatch2 = cleanText.match(/\(([A-Z0-9]{2,15})\)/);
                    if (symbolMatch1) {
                        finalTokenSymbol = symbolMatch1[1];
                    }
                    else if (symbolMatch2) {
                        finalTokenSymbol = symbolMatch2[1];
                    }
                    if (finalTokenSymbol) {
                        console.log(`    📝 Extracted symbol from bot message: ${finalTokenSymbol}`);
                    }
                }
                // Try multiple patterns for name extraction (NAME comes before SYMBOL)
                if (!finalTokenName) {
                    // Pattern 1: Token: NAME (Rick bot format) - most reliable
                    const nameMatch1 = cleanText.match(/Token:\s*([^($\[]+?)(?:\s*\(|\s*\$|\s*⋅|$)/i);
                    // Pattern 2: 🟣 NAME ($SYMBOL) or 🪙 NAME (Phanes format) - but avoid status text
                    const nameMatch2 = cleanText.match(/(?:🟣|🐶|🟢|🔷|🪙)\s*([A-Z][a-zA-Z0-9\s\-\.']+?)(?:\s*\(|\s*\[|\s*\$)/);
                    // Pattern 3: NAME ($SYMBOL) - name before symbol in parentheses (common format)
                    const nameMatch3 = cleanText.match(/^([A-Z][a-zA-Z0-9\s\-\.']+?)\s*\(/);
                    // Pattern 4: **NAME** or <strong>NAME</strong>
                    const nameMatch4 = ca.botMessageText.match(/(?:\*\*|<strong>)([^<*]+?)(?:\*\*|<\/strong>)/);
                    // Pattern 5: NAME - $SYMBOL (name before dollar sign)
                    const nameMatch5 = cleanText.match(/^([A-Z][a-zA-Z0-9\s\-\.']+?)\s*-\s*\$[A-Z0-9]/);
                    let candidateName;
                    // Try patterns in order of specificity
                    if (nameMatch1 && nameMatch1[1].trim().length > 2 && nameMatch1[1].trim().length < 50) {
                        candidateName = nameMatch1[1].trim();
                    }
                    else if (nameMatch3 && nameMatch3[1].trim().length > 2 && nameMatch3[1].trim().length < 50) {
                        candidateName = nameMatch3[1].trim();
                    }
                    else if (nameMatch5 && nameMatch5[1].trim().length > 2 && nameMatch5[1].trim().length < 50) {
                        candidateName = nameMatch5[1].trim();
                    }
                    else if (nameMatch2 && nameMatch2[1].trim().length > 2 && nameMatch2[1].trim().length < 50) {
                        candidateName = nameMatch2[1].trim();
                    }
                    else if (nameMatch4 && nameMatch4[1].trim().length > 2 && nameMatch4[1].trim().length < 50) {
                        candidateName = nameMatch4[1].trim();
                    }
                    // Clean up and validate name
                    if (candidateName) {
                        candidateName = candidateName
                            .replace(/^Token:\s*/i, '')
                            .replace(/\s*\(.*$/, '')
                            .replace(/\s*\[.*$/, '')
                            .replace(/\s*\$.*$/, '')
                            .replace(/\s*⋅.*$/, '')
                            .trim();
                        // Reject invalid names:
                        // - Too short (likely not a name)
                        // - All caps and short (likely a symbol)
                        // - Contains status emojis/text
                        // - Contains "DEX Paid" or similar status text
                        const invalidPatterns = [
                            /DEX Paid/i,
                            /🅳/,
                            /└/,
                            /🟢/,
                            /status/i,
                            /paid/i,
                            /verified/i
                        ];
                        const isInvalid = invalidPatterns.some(pattern => pattern.test(candidateName)) ||
                            (candidateName.length <= 3 && candidateName === candidateName.toUpperCase()) ||
                            candidateName.length < 2;
                        if (!isInvalid) {
                            finalTokenName = candidateName;
                            console.log(`    📝 Extracted name from bot message: ${finalTokenName}`);
                        }
                    }
                }
            }
            const finalPrice = ca.priceAtAlert ?? metadata?.price;
            const finalMarketCap = ca.marketCapAtAlert ?? metadata?.marketCap;
            // Upsert token metadata to separate table
            try {
                await upsertTokenMetadata(db, ca.tokenAddress, ca.chain, finalTokenName, finalTokenSymbol, metadata?.decimals);
                console.log(`    💾 Token metadata saved: ${finalTokenSymbol || 'N/A'} (${finalTokenName || 'N/A'})`);
            }
            catch (error) {
                console.log(`    ⚠️  Failed to save token metadata: ${error.message}`);
            }
            // First, check if there's an existing entry with lowercase address and same timestamp
            const checkQuery = `
        SELECT id, token_address FROM caller_alerts
        WHERE LOWER(token_address) = LOWER(?)
          AND alert_timestamp = ?
          AND caller_name = ?
        LIMIT 1
      `;
            db.get(checkQuery, [ca.tokenAddress, ca.alertTimestamp.toISO(), callerName], (err, row) => {
                if (err) {
                    return reject(err);
                }
                if (row) {
                    // Update existing entry with correct case
                    const updateQuery = `
            UPDATE caller_alerts
            SET token_address = ?,
                price_at_alert = COALESCE(?, price_at_alert),
                market_cap_at_alert = COALESCE(?, market_cap_at_alert),
                volume_at_alert = COALESCE(?, volume_at_alert),
                is_duplicate = ?,
                original_call_id = ?
            WHERE id = ?
          `;
                    db.run(updateQuery, [
                        ca.tokenAddress, // Correct case
                        finalPrice || null,
                        finalMarketCap || null,
                        ca.volumeAtAlert || null,
                        isDuplicate ? 1 : 0,
                        duplicateId,
                        row.id
                    ], (updateErr) => {
                        if (updateErr) {
                            return reject(updateErr);
                        }
                        if (isDuplicate) {
                            console.log(`    🔄 Updated duplicate call (original: ${duplicateId})`);
                        }
                        resolve();
                    });
                }
                else {
                    // Insert new entry (token metadata is in separate table)
                    const insertQuery = `
            INSERT OR IGNORE INTO caller_alerts
            (caller_name, token_address, chain, alert_timestamp, price_at_alert, market_cap_at_alert, volume_at_alert, is_duplicate, original_call_id, alert_message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;
                    db.run(insertQuery, [
                        callerName,
                        ca.tokenAddress, // Correct case
                        ca.chain,
                        ca.alertTimestamp.toISO(),
                        finalPrice || null,
                        finalMarketCap || null,
                        ca.volumeAtAlert || null,
                        isDuplicate ? 1 : 0,
                        duplicateId,
                        ca.originalCallerMessage || null
                    ], (insertErr) => {
                        if (insertErr) {
                            return reject(insertErr);
                        }
                        if (isDuplicate) {
                            console.log(`    🔄 Inserted duplicate call (original: ${duplicateId})`);
                        }
                        resolve();
                    });
                }
            });
        }).catch(reject);
    });
}
/**
 * Process a single message file
 */
async function processMessageFile(filePath, extractionEngine, db) {
    const fileName = path.basename(filePath);
    const channel = path.basename(path.dirname(filePath));
    try {
        console.log(`  📄 Parsing ${fileName}...`);
        const messages = parseMessagesFile(filePath);
        console.log(`    Found ${messages.length} messages`);
        if (messages.length === 0) {
            return 0;
        }
        let extractedCount = 0;
        let processedMessages = 0;
        const logInterval = Math.max(1, Math.floor(messages.length / 10)); // Log every 10%
        // Process messages in order, looking for CA drops
        for (let i = 0; i < messages.length; i++) {
            const message = messages[i];
            processedMessages++;
            // Log progress periodically
            if (processedMessages % logInterval === 0 || processedMessages === messages.length) {
                console.log(`    Processing message ${processedMessages}/${messages.length}...`);
            }
            // Get next 2 messages as potential bot replies
            const nextMessages = messages.slice(i + 1, i + 3);
            // Check if this is a caller message (not a bot)
            const isCallerMessage = !extractionEngine['isBot'](message.sender);
            if (isCallerMessage) {
                // Extract tokens from caller message and bot replies
                const extracted = await extractionEngine.extract(message, nextMessages, {
                    botMessageLookahead: 2,
                    extractMetadata: true,
                });
                if (extracted.length > 0) {
                    console.log(`    Found ${extracted.length} token(s) in message from ${message.sender}`);
                }
                // Process each extracted token - connect bot messages to original caller message
                for (const token of extracted) {
                    // Only process if it came from bot or was validated by bot (correct case)
                    if (token.source === 'bot' || token.source === 'validated') {
                        try {
                            console.log(`    🔍 Processing token: ${token.mint.substring(0, 30)}... (source: ${token.source})`);
                            // Parse timestamp from ORIGINAL caller message (not bot message)
                            let alertTimestamp;
                            const timestampStr = typeof message.timestamp === 'string' ? message.timestamp :
                                (message.timestamp instanceof luxon_1.DateTime ? message.timestamp.toISO() : '');
                            if (timestampStr) {
                                alertTimestamp = luxon_1.DateTime.fromISO(timestampStr);
                                if (!alertTimestamp.isValid) {
                                    // Try parsing as Unix timestamp
                                    const unix = parseInt(timestampStr, 10);
                                    if (!isNaN(unix)) {
                                        alertTimestamp = luxon_1.DateTime.fromSeconds(unix);
                                    }
                                    else {
                                        alertTimestamp = luxon_1.DateTime.now();
                                    }
                                }
                            }
                            else {
                                alertTimestamp = luxon_1.DateTime.now();
                            }
                            // Get bot message text if available (for better metadata extraction)
                            let botMessageText;
                            if (token.botMessageIndex !== undefined && nextMessages[token.botMessageIndex]) {
                                botMessageText = nextMessages[token.botMessageIndex].text;
                            }
                            else if (token.originalText) {
                                botMessageText = token.originalText;
                            }
                            const ca = {
                                tokenAddress: token.mint, // Correct case from bot
                                chain: token.chain,
                                alertTimestamp, // Use caller message timestamp
                                callerName: message.sender, // Original caller
                                tokenSymbol: token.metadata?.symbol,
                                tokenName: token.metadata?.name,
                                priceAtAlert: token.metadata?.price,
                                marketCapAtAlert: token.metadata?.marketCap,
                                volumeAtAlert: token.metadata?.volume,
                                originalCallerMessage: message.text, // Original caller message
                                botMessageText: botMessageText, // Bot message that validated it
                            };
                            console.log(`    💾 Saving to database...`);
                            await upsertCallerAlert(db, ca, message.sender);
                            extractedCount++;
                            // Get token metadata from token_metadata table for display
                            db.get('SELECT token_symbol, token_name FROM token_metadata WHERE mint = ?', [ca.tokenAddress], (err, tokenRow) => {
                                if (!err && tokenRow) {
                                    console.log(`    ✅ Saved call: ${tokenRow.token_symbol || 'N/A'} (${tokenRow.token_name || 'N/A'})`);
                                }
                                else {
                                    console.log(`    ✅ Saved call for token: ${ca.tokenAddress.substring(0, 20)}...`);
                                }
                            });
                        }
                        catch (error) {
                            console.log(`    ❌ Error processing token: ${error.message}`);
                            logger_1.logger.error('Error processing extracted token', error, {
                                token: token.mint.substring(0, 20),
                                file: fileName,
                            });
                        }
                    }
                }
            }
        }
        if (extractedCount > 0) {
            console.log(`  ✅ ${fileName}: ${extractedCount} tokens extracted`);
        }
        else {
            console.log(`  ⏭️  ${fileName}: No tokens found`);
        }
        return extractedCount;
    }
    catch (error) {
        console.log(`  ❌ Error processing ${fileName}: ${error.message}`);
        logger_1.logger.error('Error processing message file', error, {
            file: fileName,
        });
        return 0;
    }
}
async function main() {
    console.log(`\n${'='.repeat(80)}`);
    console.log('🔄 RE-EXTRACTING CA WITH CORRECT CASE FROM BOT REPLIES');
    console.log(`${'='.repeat(80)}\n`);
    // Initialize database
    const db = await initDatabase();
    console.log('✅ Database initialized\n');
    // Initialize extraction engine
    const extractionEngine = new chat_extraction_engine_1.ChatExtractionEngine();
    console.log('✅ Extraction engine initialized\n');
    // Get all message files
    if (!fs.existsSync(MESSAGES_DIR)) {
        console.log(`⚠️  Messages directory not found: ${MESSAGES_DIR}`);
        return;
    }
    const messageFiles = getAllMessageFiles(MESSAGES_DIR);
    console.log(`📂 Found ${messageFiles.length} message files in 'brook' folders\n`);
    if (messageFiles.length === 0) {
        console.log(`⚠️  No message files found in 'brook' folders. Exiting.`);
        db.close();
        return;
    }
    let totalExtracted = 0;
    let processedFiles = 0;
    const scriptStartTime = Date.now();
    // Process files in batches
    const BATCH_SIZE = 10;
    for (let i = 0; i < messageFiles.length; i += BATCH_SIZE) {
        const batch = messageFiles.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(messageFiles.length / BATCH_SIZE);
        const batchStartTime = Date.now();
        console.log(`\n📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} files)...`);
        for (const file of batch) {
            const fileStartTime = Date.now();
            const extracted = await processMessageFile(file, extractionEngine, db);
            const fileDuration = ((Date.now() - fileStartTime) / 1000).toFixed(1);
            totalExtracted += extracted;
            processedFiles++;
            console.log(`  ⏱️  Processed in ${fileDuration}s`);
        }
        const batchDuration = ((Date.now() - batchStartTime) / 1000).toFixed(1);
        console.log(`\n  📊 Batch ${batchNum} complete: ${processedFiles}/${messageFiles.length} files, ${totalExtracted} tokens extracted (${batchDuration}s)`);
    }
    const totalDuration = ((Date.now() - scriptStartTime) / 1000).toFixed(1);
    console.log(`\n⏱️  Total processing time: ${totalDuration}s`);
    db.close();
    console.log(`\n${'='.repeat(80)}`);
    console.log('📊 FINAL SUMMARY');
    console.log(`${'='.repeat(80)}\n`);
    console.log(`Files processed: ${processedFiles}`);
    console.log(`Tokens extracted: ${totalExtracted}`);
    console.log(`\n✅ Done. Database updated with correct case addresses.\n`);
}
if (require.main === module) {
    main().catch((error) => {
        console.error('Fatal error:', error);
        logger_1.logger.error('Fatal error', error);
        process.exit(1);
    });
}
//# sourceMappingURL=re-extract-ca-with-case-from-bot-replies.js.map