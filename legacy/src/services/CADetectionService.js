"use strict";
/**
 * CA Detection Service
 * ====================
 * Handles contract address (CA) drop detection and processing including
 * address validation, chain identification, token metadata fetching,
 * and monitoring setup.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CADetectionService = void 0;
const axios_1 = __importDefault(require("axios"));
const database_1 = require("../utils/database");
const logger_1 = require("../utils/logger");
class CADetectionService {
    constructor() {
        this.DEFAULT_STRATEGY = [
            { percent: 0.5, target: 2 },
            { percent: 0.3, target: 5 },
            { percent: 0.2, target: 10 }
        ];
    }
    /**
     * Detects contract address (CA) drops in free-form user text.
     * Returns true if any CA was detected/processed, otherwise false.
     */
    async detectCADrop(ctx, text) {
        // Regex patterns for Solana and EVM addresses
        const solanaAddressPattern = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
        const evmAddressPattern = /0x[a-fA-F0-9]{40}/g;
        const solanaMatches = text.match(solanaAddressPattern);
        const evmMatches = text.match(evmAddressPattern);
        const addresses = [...(solanaMatches || []), ...(evmMatches || [])];
        if (addresses.length === 0)
            return false;
        // Detect if the message context really looks like a CA drop (keywords/trading context, etc).
        const caKeywords = ['ca', 'contract', 'address', 'buy', 'pump', 'moon', 'gem', 'call'];
        const hasCAKeywords = caKeywords.some(keyword => text.toLowerCase().includes(keyword));
        if (!hasCAKeywords && addresses.length === 1) {
            // Ignore single addresses when not in a drop context.
            return false;
        }
        logger_1.logger.debug('Potential CA drop detected', { addresses, hasKeywords: hasCAKeywords });
        // Process all CA(s) found in message
        for (const address of addresses) {
            try {
                await this.processCADrop(ctx, address);
            }
            catch (error) {
                logger_1.logger.error('Error processing CA drop', error instanceof Error ? error : new Error(String(error)), { address });
            }
        }
        return true;
    }
    /**
     * Handles CA registration + monitoring.
     * Identifies chain, fetches meta, logs and monitors (if enabled).
     */
    async processCADrop(ctx, address) {
        const userId = ctx.from?.id;
        const chatId = ctx.chat?.id;
        if (!userId || !chatId) {
            logger_1.logger.warn('Invalid context for CA processing', { userId, chatId });
            return;
        }
        // Validate address is plausible (format)
        const solanaPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
        const evmPattern = /^0x[a-fA-F0-9]{40}$/;
        if (!solanaPattern.test(address) && !evmPattern.test(address)) {
            logger_1.logger.warn('Invalid address format', { address });
            return;
        }
        // Decide which chain to try first (BSC/EVM fallback, else Solana)
        let chain = 'solana';
        if (address.startsWith('0x')) {
            chain = 'bsc'; // EVM heuristic: most new tokens first appear on BSC
        }
        try {
            // Try fetching meta-data (EVM: try BSC, ETH, BASE)
            let tokenData = null;
            let finalChain = chain;
            if (address.startsWith('0x')) {
                const chainsToTry = ['bsc', 'ethereum', 'base'];
                for (const tryChain of chainsToTry) {
                    try {
                        logger_1.logger.debug('Trying chain for address', { chain: tryChain, address });
                        const meta = await axios_1.default.get(`https://public-api.birdeye.so/defi/v3/token/meta-data/single`, {
                            headers: {
                                'X-API-KEY': process.env.BIRDEYE_API_KEY,
                                'accept': 'application/json',
                                'x-chain': tryChain
                            },
                            params: { address }
                        });
                        if (meta.data.success && meta.data.data) {
                            tokenData = meta.data.data;
                            finalChain = tryChain;
                            logger_1.logger.debug('Found token on chain', { chain: tryChain, tokenName: tokenData?.name, address });
                            break;
                        }
                    }
                    catch (err) {
                        logger_1.logger.debug('Failed to find token on chain', { chain: tryChain, address });
                        continue;
                    }
                }
            }
            else {
                // Try Solana
                const meta = await axios_1.default.get(`https://public-api.birdeye.so/defi/v3/token/meta-data/single`, {
                    headers: {
                        'X-API-KEY': process.env.BIRDEYE_API_KEY,
                        'accept': 'application/json',
                        'x-chain': chain
                    },
                    params: { address }
                });
                tokenData = meta.data.data;
                finalChain = chain;
            }
            if (!tokenData) {
                logger_1.logger.warn('Token metadata not found on any supported chain', { address });
                return;
            }
            const typedTokenData = tokenData;
            // Fetch current price and market cap using token overview endpoint
            let currentPrice = 0;
            let marketcap = 0;
            try {
                const overviewResponse = await axios_1.default.get(`https://public-api.birdeye.so/defi/token_overview`, {
                    headers: {
                        'X-API-KEY': process.env.BIRDEYE_API_KEY,
                        'accept': 'application/json',
                        'x-chain': finalChain
                    },
                    params: { address }
                });
                if (overviewResponse.data.success && overviewResponse.data.data) {
                    currentPrice = overviewResponse.data.data.price || 0;
                    marketcap = overviewResponse.data.data.marketCap || 0;
                }
            }
            catch (error) {
                logger_1.logger.warn('Failed to fetch token overview', { address, error: error instanceof Error ? error.message : String(error) });
                // Fallback to token metadata if available
                currentPrice = typedTokenData.price || 0;
                marketcap = typedTokenData.mc || 0;
            }
            // Always use default strategy/SL for auto CA monitoring
            const strategy = this.DEFAULT_STRATEGY;
            const stopLossConfig = { initial: -0.5, trailing: 0.5 };
            // Save CA drop in database for tracking/history
            const caId = await (0, database_1.saveCADrop)({
                userId,
                chatId,
                mint: address,
                chain: finalChain,
                tokenName: tokenData.name,
                tokenSymbol: tokenData.symbol,
                callPrice: currentPrice,
                callMarketcap: marketcap,
                callTimestamp: Math.floor(Date.now() / 1000),
                strategy,
                stopLossConfig
            });
            // If Solana and Helius monitor present, register for realtime updates
            try {
                const heliusMonitor = require('../helius-monitor').HeliusMonitor;
                if (heliusMonitor && finalChain === 'solana') {
                    await heliusMonitor.addCATracking({
                        id: caId,
                        mint: address,
                        chain: finalChain,
                        tokenName: tokenData.name,
                        tokenSymbol: tokenData.symbol,
                        callPrice: currentPrice,
                        callMarketcap: marketcap,
                        callTimestamp: Math.floor(Date.now() / 1000),
                        strategy,
                        stopLossConfig,
                        chatId,
                        userId
                    });
                }
            }
            catch (error) {
                logger_1.logger.warn('Helius monitor not available', { error: error instanceof Error ? error.message : String(error) });
            }
            // Compose confirmation message to user/chat
            const chainEmoji = finalChain === 'ethereum' ? '⟠' :
                finalChain === 'bsc' ? '🟡' :
                    finalChain === 'base' ? '🔵' : '◎';
            const monitoringStatus = finalChain === 'solana' ?
                '✅ Real-time monitoring active!' :
                '⚠️ Real-time monitoring not available for this chain';
            const message = `🎯 **CA Drop Detected & Tracking Started!**\n\n` +
                `${chainEmoji} Chain: ${finalChain.toUpperCase()}\n` +
                `🪙 Token: ${tokenData?.name || 'Unknown'} (${tokenData?.symbol || 'N/A'})\n` +
                `💰 Price: ${currentPrice > 0 ? `$${currentPrice.toFixed(8)}` : 'Loading...'}\n` +
                `📊 Market Cap: ${marketcap > 0 ? `$${(marketcap / 1000000).toFixed(2)}M` : 'Loading...'}\n` +
                `📈 Strategy: 50%@2x, 30%@5x, 20%@10x\n` +
                `🛑 Stop Loss: -50% initial, 50% trailing\n\n` +
                `${monitoringStatus}`;
            await ctx.reply(message, { parse_mode: 'Markdown' });
            logger_1.logger.info('Started tracking CA', { tokenName: tokenData.name, address, chain: finalChain });
        }
        catch (error) {
            logger_1.logger.error('Error fetching token metadata for CA', error instanceof Error ? error : new Error(String(error)), { address });
            // On errors during CA detection, fail silently to avoid chat spam
        }
    }
}
exports.CADetectionService = CADetectionService;
//# sourceMappingURL=CADetectionService.js.map