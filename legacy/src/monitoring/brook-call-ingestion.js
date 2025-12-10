"use strict";
/**
 * Brook Call Ingestion Module
 * ===========================
 * Ingests forwarded calls from Brook's channel, extracts token addresses,
 * stores them in the database, and adds them to live monitoring services.
 *
 * This module listens for forwarded messages in your personal Telegram chat
 * and automatically processes them.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrookCallIngestion = void 0;
const telegraf_1 = require("telegraf");
const luxon_1 = require("luxon");
const axios_1 = __importDefault(require("axios"));
const caller_database_1 = require("../storage/caller-database");
const logger_1 = require("../utils/logger");
const CALLER_NAME = 'Brook';
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || '';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '';
const PERSONAL_CHAT_ID = process.env.PERSONAL_CHAT_ID || '';
/**
 * Extract token addresses from text
 */
function extractTokenAddresses(text) {
    const addresses = [];
    if (!text)
        return addresses;
    // Clean text
    let cleanText = text.replace(/<[^>]+>/g, ' ');
    cleanText = cleanText.replace(/&apos;/g, "'");
    cleanText = cleanText.replace(/&quot;/g, '"');
    cleanText = cleanText.replace(/&amp;/g, '&');
    // Solana: base58 addresses (32-44 chars)
    const solanaRegex = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
    const solanaMatches = cleanText.match(solanaRegex) || [];
    const validSolana = solanaMatches.filter(addr => {
        const len = addr.length;
        if (len < 32 || len > 44)
            return false;
        if (addr.toUpperCase().startsWith('DEF'))
            return false;
        return true;
    });
    addresses.push(...validSolana);
    // EVM: 0x + 40 hex chars
    const evmRegex = /0x[a-fA-F0-9]{40}\b/g;
    const evmMatches = cleanText.match(evmRegex) || [];
    addresses.push(...evmMatches);
    // Addresses in code blocks
    const codeBlockRegex = /`([1-9A-HJ-NP-Za-km-z]{32,44})`/g;
    const codeMatches = cleanText.match(codeBlockRegex) || [];
    codeMatches.forEach(match => {
        const addr = match.replace(/`/g, '').trim();
        if (addr.length >= 32 && addr.length <= 44 && !addr.toUpperCase().startsWith('DEF')) {
            if (!addresses.includes(addr)) {
                addresses.push(addr);
            }
        }
    });
    // Phanes bot format: "├ ADDRESS└"
    const phanesFormatRegex = /├\s*([1-9A-HJ-NP-Za-km-z]{32,44})\s*└/g;
    const phanesMatches = cleanText.matchAll(phanesFormatRegex);
    for (const match of phanesMatches) {
        const addr = match[1];
        if (addr && addr.length >= 32 && addr.length <= 44 && !addr.toUpperCase().startsWith('DEF')) {
            if (!addresses.includes(addr)) {
                addresses.push(addr);
            }
        }
    }
    // Remove duplicates
    const unique = new Set();
    addresses.forEach(addr => {
        if (addr.startsWith('0x')) {
            unique.add(addr.toLowerCase());
        }
        else {
            unique.add(addr);
        }
    });
    return Array.from(unique);
}
/**
 * Determine chain from address format
 */
function determineChain(address) {
    if (address.startsWith('0x')) {
        // Default to BSC for EVM addresses (most common for new tokens)
        return 'bsc';
    }
    return 'solana';
}
/**
 * Fetch token metadata from Birdeye
 */
async function fetchTokenMetadata(address, chain) {
    try {
        const response = await axios_1.default.get('https://public-api.birdeye.so/defi/v3/token/meta-data/single', {
            params: { address },
            headers: {
                'X-API-KEY': BIRDEYE_API_KEY,
                'accept': 'application/json',
                'x-chain': chain,
            },
            timeout: 10000,
        });
        if (response.data?.success && response.data?.data) {
            const data = response.data.data;
            const price = parseFloat(data.price || '0');
            return {
                name: data.name || 'Unknown',
                symbol: data.symbol || 'UNKNOWN',
                price,
            };
        }
    }
    catch (error) {
        logger_1.logger.warn('Failed to fetch token metadata', {
            address,
            chain,
            error: error.message,
        });
    }
    return null;
}
/**
 * Brook Call Ingestion Service
 *
 * Listens to your personal Telegram chat for manually forwarded messages from Brook's channel.
 * Since Brook's channel is invite-only, you must manually forward messages to your personal chat.
 */
class BrookCallIngestion {
    constructor(botToken, personalChatId, liveTradeService, tenkanKijunService) {
        this.liveTradeService = null;
        this.tenkanKijunService = null;
        this.processedMessageIds = new Set();
        this.bot = new telegraf_1.Telegraf(botToken);
        this.callerDb = new caller_database_1.CallerDatabase();
        this.personalChatId = personalChatId;
        this.liveTradeService = liveTradeService || null;
        this.tenkanKijunService = tenkanKijunService || null;
        this.setupHandlers();
    }
    /**
     * Check if message is from personal chat
     */
    isFromPersonalChat(ctx) {
        const chatId = ctx.chat?.id;
        if (!chatId)
            return false;
        const personalChatIdNum = parseInt(this.personalChatId);
        const chatIdStr = String(chatId);
        const personalChatIdStr = this.personalChatId;
        return chatId === personalChatIdNum || chatIdStr === personalChatIdStr;
    }
    /**
     * Check if message is forwarded from Brook's channel
     */
    isForwardedFromBrook(message) {
        // Check if message is forwarded
        const forwardFrom = message.forward_from_chat;
        if (!forwardFrom) {
            return false;
        }
        // Check if forwarded from a channel (Brook's channel)
        if (forwardFrom.type === 'channel') {
            // Accept all forwarded channel messages (assuming user only forwards from Brook)
            return true;
        }
        return false;
    }
    /**
     * Setup Telegram message handlers
     */
    setupHandlers() {
        // Handle all messages in personal chat (including forwarded)
        this.bot.on('message', async (ctx) => {
            if (this.isFromPersonalChat(ctx)) {
                const message = ctx.message;
                // Process if it's a forwarded message (from Brook's channel)
                // OR if it's a regular message (user might paste token addresses directly)
                if (this.isForwardedFromBrook(message) || 'text' in message || 'caption' in message) {
                    await this.handleMessage(ctx);
                }
            }
        });
        // Handle edited messages
        this.bot.on('edited_message', async (ctx) => {
            if (this.isFromPersonalChat(ctx)) {
                await this.handleMessage(ctx);
            }
        });
    }
    /**
     * Handle any message (forwarded or regular)
     */
    async handleMessage(ctx) {
        const message = ctx.message;
        if (!message)
            return;
        const messageId = message.message_id;
        // Avoid processing duplicates
        if (this.processedMessageIds.has(messageId)) {
            logger_1.logger.debug('Message already processed', { messageId });
            return;
        }
        // Extract text from message
        let text = '';
        if ('text' in message && message.text) {
            text = message.text;
        }
        else if ('caption' in message && message.caption) {
            text = message.caption;
        }
        if (!text) {
            logger_1.logger.debug('No text found in message', { messageId });
            return;
        }
        // Log if this is a forwarded message
        const isForwarded = this.isForwardedFromBrook(message);
        if (isForwarded) {
            logger_1.logger.info('Received forwarded message from Brook channel', {
                messageId,
                textPreview: text.substring(0, 100),
            });
        }
        else {
            logger_1.logger.info('Received message in personal chat', {
                messageId,
                textPreview: text.substring(0, 100),
            });
        }
        // Extract token addresses
        const addresses = extractTokenAddresses(text);
        if (addresses.length === 0) {
            logger_1.logger.debug('No token addresses found in message', { messageId });
            return;
        }
        logger_1.logger.info('Processing Brook call', {
            messageId,
            addressCount: addresses.length,
            addresses: addresses.map(a => a.substring(0, 8) + '...'),
        });
        // Process each address
        for (const address of addresses) {
            try {
                await this.processTokenAddress(address, text, messageId);
            }
            catch (error) {
                logger_1.logger.error('Error processing token address', error, {
                    address,
                    messageId,
                });
            }
        }
        this.processedMessageIds.add(messageId);
        // Clean up old message IDs
        if (this.processedMessageIds.size > 1000) {
            const oldestIds = Array.from(this.processedMessageIds).slice(0, 100);
            oldestIds.forEach(id => this.processedMessageIds.delete(id));
        }
    }
    /**
     * Process a single token address
     */
    async processTokenAddress(address, originalText, messageId) {
        const chain = determineChain(address);
        // Fetch token metadata
        const metadata = await fetchTokenMetadata(address, chain);
        if (!metadata) {
            logger_1.logger.warn('Could not fetch token metadata', { address, chain });
            // Still add to database with minimal info
        }
        const tokenSymbol = metadata?.symbol || 'UNKNOWN';
        const tokenName = metadata?.name || 'Unknown Token';
        const price = metadata?.price || 0;
        // Create caller alert
        const alert = {
            callerName: CALLER_NAME,
            tokenAddress: address,
            tokenSymbol,
            chain,
            alertTimestamp: new Date(),
            alertMessage: originalText.substring(0, 500), // Truncate long messages
            priceAtAlert: price,
            volumeAtAlert: null,
        };
        // Store in database
        try {
            const alertId = await this.callerDb.addCallerAlert(alert);
            logger_1.logger.info('Stored Brook call in database', {
                alertId,
                tokenSymbol,
                address: address.substring(0, 8) + '...',
                price,
            });
            // Add to live monitoring services
            if (this.liveTradeService && this.liveTradeService.getStatus().isRunning) {
                const alertWithId = { ...alert, id: alertId };
                await this.liveTradeService.addToken(alertWithId);
                logger_1.logger.info('Added token to live trade service', { tokenSymbol });
            }
            if (this.tenkanKijunService) {
                const alertTime = luxon_1.DateTime.fromJSDate(alert.alertTimestamp);
                await this.tenkanKijunService.addToken(address, tokenSymbol, chain, CALLER_NAME, alertTime, price);
                logger_1.logger.info('Added token to Tenkan/Kijun service', { tokenSymbol });
            }
            // Send confirmation to personal chat (if configured)
            if (this.personalChatId) {
                try {
                    await this.bot.telegram.sendMessage(this.personalChatId, `✅ **Brook Call Ingested**\n\n` +
                        `🪙 **${tokenName}** (${tokenSymbol})\n` +
                        `📍 **Chain:** ${chain.toUpperCase()}\n` +
                        `🔗 **Address:** \`${address}\`\n` +
                        `💰 **Price:** $${price.toFixed(8)}\n` +
                        `📊 **Status:** ${this.liveTradeService?.getStatus().isRunning ? 'Monitoring' : 'Stored'}`, { parse_mode: 'Markdown' });
                }
                catch (error) {
                    logger_1.logger.warn('Failed to send confirmation message', {
                        error: error.message,
                    });
                }
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to store Brook call', error, {
                address,
                tokenSymbol,
            });
            throw error;
        }
    }
    /**
     * Start the ingestion service
     */
    async start() {
        try {
            logger_1.logger.info('Starting Brook call ingestion service');
            const botInfo = await this.bot.telegram.getMe();
            logger_1.logger.info('Bot initialized', { username: botInfo.username });
            await this.bot.launch();
            logger_1.logger.info('Brook call ingestion service started successfully');
        }
        catch (error) {
            logger_1.logger.error('Failed to start ingestion service', error);
            throw error;
        }
    }
    /**
     * Stop the ingestion service
     */
    stop() {
        logger_1.logger.info('Stopping Brook call ingestion service');
        this.bot.stop();
    }
}
exports.BrookCallIngestion = BrookCallIngestion;
exports.default = BrookCallIngestion;
//# sourceMappingURL=brook-call-ingestion.js.map