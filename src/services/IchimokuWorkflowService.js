"use strict";
/**
 * Ichimoku Workflow Service
 * ========================
 * Handles Ichimoku Cloud analysis workflow including token validation,
 * historical data fetching, and real-time monitoring setup.
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
exports.IchimokuWorkflowService = void 0;
const axios_1 = __importDefault(require("axios"));
const luxon_1 = require("luxon");
const candles_1 = require("../simulation/candles");
const logger_1 = require("../utils/logger");
class IchimokuWorkflowService {
    constructor(sessionService) {
        this.sessionService = sessionService;
    }
    /**
     * Handles the Ichimoku workflow steps for token address and chain selection.
     */
    async handleIchimokuWorkflow(ctx, session, text) {
        const userId = ctx.from?.id;
        if (!userId) {
            await ctx.reply('❌ Unable to identify user.');
            return;
        }
        // Ensure session.data exists
        if (!session.data) {
            session.data = {};
        }
        // Step 1: Mint address (detect EVM vs. Solana chain)
        if (!session.data.mint) {
            session.data.mint = text;
            if (text.startsWith('0x') && text.length === 42) {
                await ctx.reply('🔗 Detected EVM address.\n\n' +
                    'Which chain?\n' +
                    '1️⃣ Ethereum (ETH)\n' +
                    '2️⃣ Binance Smart Chain (BSC)\n' +
                    '3️⃣ Base (BASE)\n\n' +
                    'Reply with: eth, bsc, or base');
                this.sessionService.setSession(userId, session);
                return;
            }
            else {
                session.data.chain = 'solana';
                this.sessionService.setSession(userId, session);
                await this.startIchimokuAnalysis(ctx, session);
                return;
            }
        }
        // Step 1.5: For EVM, ask for the specific chain
        if (session.data.mint && !session.data.chain) {
            const input = text.toLowerCase();
            if (input === 'eth' || input === 'ethereum') {
                session.data.chain = 'ethereum';
            }
            else if (input === 'bsc' || input === 'binance') {
                session.data.chain = 'bsc';
            }
            else if (input === 'base') {
                session.data.chain = 'base';
            }
            else {
                await ctx.reply('❌ Invalid chain. Reply with: eth, bsc, or base');
                return;
            }
            this.sessionService.setSession(userId, session);
            await this.startIchimokuAnalysis(ctx, session);
            return;
        }
    }
    /**
     * Starts the Ichimoku analysis process including data fetching and monitoring setup.
     */
    async startIchimokuAnalysis(ctx, session) {
        const userId = ctx.from?.id;
        if (!userId) {
            await ctx.reply('❌ Unable to identify user.');
            return;
        }
        try {
            await ctx.reply('📈 **Starting Ichimoku Analysis...**\n\nFetching 52 historical 5-minute candles from Birdeye...');
            // Fetch token metadata first
            let tokenName = 'Unknown';
            let tokenSymbol = 'N/A';
            if (!session.data) {
                await ctx.reply('❌ Session data is missing.');
                return;
            }
            try {
                const meta = await axios_1.default.get(`https://public-api.birdeye.so/defi/v3/token/meta-data/single`, {
                    headers: {
                        'X-API-KEY': process.env.BIRDEYE_API_KEY,
                        'accept': 'application/json',
                        'x-chain': session.data.chain || 'solana'
                    },
                    params: {
                        address: session.data.mint
                    }
                });
                if (!meta.data.success) {
                    await ctx.reply(`❌ **Invalid Token Address**\n\n` +
                        `The address \`${session.data.mint}\` is not recognized as a valid token on ${(session.data.chain || 'solana').toUpperCase()}.\n\n` +
                        `**Possible reasons:**\n` +
                        `• Not a token mint address\n` +
                        `• Program ID or account address\n` +
                        `• Token doesn't exist\n` +
                        `• Invalid address format\n\n` +
                        `Please verify the address and try again.`, { parse_mode: 'Markdown' });
                    this.sessionService.clearSession(userId);
                    return;
                }
                tokenName = meta.data.data.name;
                tokenSymbol = meta.data.data.symbol;
            }
            catch (e) {
                logger_1.logger.warn('Could not fetch metadata, using defaults', { mint: session.data.mint, chain: session.data.chain });
            }
            // Calculate time range: 52 candles * 5 minutes = 260 minutes = ~4.3 hours
            const endTime = luxon_1.DateTime.now().toUTC();
            const startTime = endTime.minus({ minutes: 260 }); // 52 * 5 minutes
            // Fetch historical candles
            let candles;
            try {
                if (!session.data?.mint || !session.data?.chain) {
                    await ctx.reply('❌ Missing token address or chain.');
                    return;
                }
                candles = await (0, candles_1.fetchHybridCandles)(session.data.mint, startTime, endTime, session.data.chain);
            }
            catch (error) {
                logger_1.logger.error('Candle fetching error', error, { mint: session.data?.mint, chain: session.data?.chain });
                await ctx.reply(`❌ **Failed to Fetch Historical Data**\n\n` +
                    `Error: ${error.response?.data?.message || error.message}\n\n` +
                    `**Possible solutions:**\n` +
                    `• Verify the token address is correct\n` +
                    `• Check if the token has sufficient trading history\n` +
                    `• Try a different token\n\n` +
                    `The token may not have enough trading data for Ichimoku analysis.`, { parse_mode: 'Markdown' });
                this.sessionService.clearSession(userId);
                return;
            }
            if (candles.length < 52) {
                await ctx.reply(`❌ **Insufficient Historical Data**\n\n` +
                    `Only found ${candles.length} candles, need at least 52 for Ichimoku analysis.\n\n` +
                    `**This token may:**\n` +
                    `• Be too new (less than 4+ hours of trading)\n` +
                    `• Have low trading volume\n` +
                    `• Not be actively traded\n\n` +
                    `Try a token with more trading history.`, { parse_mode: 'Markdown' });
                this.sessionService.clearSession(userId);
                return;
            }
            // Calculate current Ichimoku data
            const { calculateIchimoku, formatIchimokuData } = await Promise.resolve().then(() => __importStar(require('../simulation/ichimoku')));
            const currentIndex = candles.length - 1;
            const ichimokuData = calculateIchimoku(candles, currentIndex);
            if (!ichimokuData) {
                await ctx.reply('❌ **Ichimoku Calculation Failed**\n\nCould not calculate Ichimoku components from the historical data.');
                this.sessionService.clearSession(userId);
                return;
            }
            // Get current price
            const currentPrice = candles[currentIndex].close;
            // Start real-time monitoring with historical candles
            const heliusMonitor = require('../helius-monitor').HeliusMonitor;
            const monitor = new heliusMonitor(ctx.telegram);
            // Add CA tracking with pre-loaded historical candles
            if (!session.data?.mint || !session.data?.chain) {
                await ctx.reply('❌ Missing token address or chain.');
                return;
            }
            await monitor.addCATrackingWithCandles({
                userId: userId,
                chatId: ctx.chat?.id || 0,
                mint: session.data.mint,
                chain: session.data.chain,
                tokenName: tokenName,
                tokenSymbol: tokenSymbol,
                callPrice: currentPrice,
                callTimestamp: Math.floor(Date.now() / 1000),
                strategy: [{ percent: 1, target: 1 }], // Dummy strategy for monitoring
                stopLossConfig: { initial: -0.3, trailing: 'none' },
                historicalCandles: candles
            });
            // Send initial Ichimoku analysis
            const chain = session.data?.chain || 'solana';
            const analysisMessage = `📈 **Ichimoku Analysis Started!**\n\n` +
                `🪙 **${tokenName}** (${tokenSymbol})\n` +
                `🔗 **Chain**: ${chain.toUpperCase()}\n` +
                `💰 **Current Price**: $${currentPrice.toFixed(8)}\n\n` +
                formatIchimokuData(ichimokuData, currentPrice) + `\n\n` +
                `✅ **Real-time monitoring active!**\n` +
                `I'll send alerts when Ichimoku signals are detected.`;
            await ctx.reply(analysisMessage, { parse_mode: 'Markdown' });
            // Clear session
            this.sessionService.clearSession(userId);
        }
        catch (error) {
            logger_1.logger.error('Ichimoku analysis error', error, { userId, mint: session.data?.mint });
            await ctx.reply('❌ **Ichimoku Analysis Failed**\n\nAn error occurred while fetching historical data. Please try again later.');
            this.sessionService.clearSession(userId);
        }
    }
}
exports.IchimokuWorkflowService = IchimokuWorkflowService;
//# sourceMappingURL=IchimokuWorkflowService.js.map