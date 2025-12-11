"use strict";
/**
 * QuantBot Main Logic
 * ===================
 * Core logic for QuantBot Telegram bot, enabling backtesting of token strategies and real-time contract address (CA) drop monitoring.
 *
 * Features:
 * - Interactive, stateful chat workflow for simulating and optimizing token trading strategies.
 * - Supports multiple blockchains: Solana, Ethereum, BSC, and Base.
 * - Manages custom strategies (save, use, delete).
 * - Detects and monitors contract drops, automating token tracking.
 *
 * Code Structure:
 *  1. Imports & Initialization
 *  2. Core Constants & Types
 *  3. Command Handlers (/backtest, /repeat, /broadcast, /cancel, /strategy)
 *  4. Main Stateful Text Handler (workflow engine)
 *  5. CA Drop Detection & Processing
 *  6. Bot Startup/Shutdown
 *
 * Design Principles:
 * - Consistent, readable comments.
 * - Maintainability via clear typing & session schema.
 * - Ready for upgrades: settings per session, new chains, strategy types.
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
// -----------------------------------------------------------------------------
// 1. Imports & Bot Initialization
// -----------------------------------------------------------------------------
const telegraf_1 = require("telegraf");
const axios_1 = __importDefault(require("axios"));
const luxon_1 = require("luxon");
const dotenv_1 = __importDefault(require("dotenv"));
const candles_1 = require("../simulation/candles");
const engine_1 = require("../simulation/engine");
const database_1 = require("../utils/database");
const helius_monitor_1 = require("../helius-monitor");
const helius_recorder_1 = require("../services/stream/helius-recorder");
const helius_backfill_service_1 = require("../services/backfill/helius-backfill-service");
const pumpfun_lifecycle_tracker_1 = require("../services/pumpfun/pumpfun-lifecycle-tracker");
const caller_database_1 = require("../utils/caller-database");
const logger_1 = require("../utils/logger");
// Load environment variables (API keys, bot token, etc.)
dotenv_1.default.config();
// Create Telegram Bot instance
const bot = new telegraf_1.Telegraf(process.env.BOT_TOKEN);
const DEFAULT_CHAT_ID = process.env.TELEGRAM_DEFAULT_CHAT;
// Helius monitor for Solana real-time CA tracking (enabled if key is available)
let heliusMonitor = null;
// -----------------------------------------------------------------------------
// 2. Core Constants & Types
// -----------------------------------------------------------------------------
/**
 * Default take profit ladder for new strategies and simulations.
 * Each element is a step: percent to sell at given multiple from entry price.
 */
const DEFAULT_STRATEGY = [
    { percent: 0.5, target: 2 }, // Sell 50% at 2x
    { percent: 0.3, target: 5 }, // Sell 30% at 5x
    { percent: 0.2, target: 10 }, // Sell 20% at 10x
];
/**
 * Session Type: Stores all state per user during an interactive session.
 * Extendable for more steps/settings.
 * Now using proper types from types/session.ts
 */
// Sessions: In-memory userID => session mapping
const sessions = {};
// -----------------------------------------------------------------------------
// 3. Bot Command Handlers
// -----------------------------------------------------------------------------
/**
 * /backtest
 * Begin a new simulation workflow.
 * Prompts for mint address entry.
 */
bot.command('backtest', ctx => {
    const userId = ctx.from.id;
    sessions[userId] = {};
    ctx.reply('🤖 QuantBot Ready!\n\nPaste a token mint address to begin your simulation.');
});
/**
 * /repeat
 * Enables user to select and rerun a previous simulation, with parameter changes allowed.
 */
bot.command('repeat', async (ctx) => {
    const userId = ctx.from.id;
    try {
        const recentRuns = await (0, database_1.getUserSimulationRuns)(userId, 5);
        if (recentRuns.length === 0) {
            ctx.reply('❌ No previous simulations found. Use /backtest first.');
            return;
        }
        if (recentRuns.length > 1) {
            // Show last N runs, let user pick
            let message = '🔄 **Recent Simulations:**\n\n';
            recentRuns.forEach((run, idx) => {
                const chainEmoji = run.chain === 'ethereum' ? '⟠' : run.chain === 'bsc' ? '🟡' : run.chain === 'base' ? '🔵' : '◎';
                const timeAgo = run.startTime.toRelative();
                message += `${idx + 1}. ${chainEmoji} **${run.tokenName || 'Unknown'}** (${run.tokenSymbol || 'N/A'})\n`;
                message += `   📅 ${run.startTime.toFormat('MM-dd HH:mm')} - ${run.endTime.toFormat('MM-dd HH:mm')}\n`;
                message += `   💰 PNL: ${(run.finalPnl || 0).toFixed(2)}x | ${timeAgo}\n\n`;
            });
            message += '**Reply with the number** (1-5) to repeat, or **"last"** for the oldest.';
            ctx.reply(message, { parse_mode: 'Markdown' });
            sessions[userId] = { ...sessions[userId], waitingForRunSelection: true, recentRuns };
            return;
        }
        // Use the OLDEST run (last in array since sorted by most recent first)
        const oldestRun = recentRuns[recentRuns.length - 1];
        await repeatSimulation(ctx, oldestRun);
    }
    catch (err) {
        ctx.reply('❌ An error occurred while fetching previous simulations.');
        logger_1.logger.error('Repeat command error', err, { userId: ctx.from?.id });
    }
});
/**
 * Helper: Primes a session from a previous run's parameters so user can rerun/re-edit.
 */
async function repeatSimulation(ctx, run) {
    const userId = ctx.from?.id;
    if (!userId)
        return;
    sessions[userId] = {
        mint: run.mint,
        chain: run.chain,
        datetime: run.startTime,
        metadata: { name: run.tokenName || 'Unknown', symbol: run.tokenSymbol || 'N/A' },
        strategy: undefined,
        stopLossConfig: undefined,
        lastSimulation: {
            mint: run.mint,
            chain: run.chain,
            datetime: run.startTime,
            metadata: { name: run.tokenName || 'Unknown', symbol: run.tokenSymbol || 'N/A' },
            candles: [],
        },
    };
    const chainEmoji = run.chain === 'ethereum' ? '⟠' : run.chain === 'bsc' ? '🟡' : run.chain === 'base' ? '🔵' : '◎';
    ctx.reply(`🔄 **Repeating Simulation**\n\n` +
        `${chainEmoji} Chain: ${run.chain.toUpperCase()}\n` +
        `🪙 Token: ${run.tokenName} (${run.tokenSymbol})\n` +
        `📅 Period: ${run.startTime.toFormat('yyyy-MM-dd HH:mm')} - ${run.endTime.toFormat('yyyy-MM-dd HH:mm')}\n\n` +
        `**Take Profit Strategy:**\n• \`yes\` - Default: 50%@2x, 30%@5x, 20%@10x\n• \`50@2x,30@5x,20@10x\` - Custom\n• \`[{"percent":0.5,"target":2}]\` - JSON`);
}
/**
 * /extract
 * Extract CA drops from chat messages and save to database
 */
bot.command('extract', async (ctx) => {
    const userId = ctx.from.id;
    try {
        ctx.reply('📥 **Extracting CA Drops from Messages...**\n\nProcessing HTML files in the messages folder...');
        // Run the extraction script
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        const { stdout, stderr } = await execAsync('node extract_ca_drops_v2.js');
        if (stderr) {
            logger_1.logger.warn('Extraction stderr', { stderr, userId });
        }
        // Parse the output to get extraction results
        const lines = stdout.split('\n');
        const extractedCount = lines.find((line) => line.includes('Extracted'))?.match(/(\d+)/)?.[1] || '0';
        const savedCount = lines.find((line) => line.includes('Saved'))?.match(/(\d+)/)?.[1] || '0';
        ctx.reply(`✅ **Extraction Complete!**\n\n📊 **Results:**\n• Extracted: ${extractedCount} CA drops\n• Saved to database: ${savedCount}\n\nUse \`/analysis\` to run historical analysis on the extracted data.`);
    }
    catch (error) {
        logger_1.logger.error('Extraction command error', error, { userId });
        ctx.reply('❌ **Extraction Failed**\n\nAn error occurred during CA extraction. Make sure the messages folder exists and contains HTML files.');
    }
});
/**
 * /analysis
 * Run historical analysis on all CA drops
 */
bot.command('analysis', async (ctx) => {
    const userId = ctx.from.id;
    try {
        ctx.reply('🔍 **Starting Historical Analysis...**\n\nThis may take a few minutes while fetching current prices for all tracked CAs...');
        // Historical analysis feature temporarily disabled
        ctx.reply('⚠️ Historical analysis feature is temporarily disabled. Use /backtest to run simulations instead.');
    }
    catch (error) {
        logger_1.logger.error('Analysis command error', error, { userId });
        let errorMessage = '❌ **Analysis Failed**\n\nAn error occurred during the historical analysis. Please try again later.';
        // If the error has a message, append it for more transparency (but avoid leaking sensitive details)
        const err = error;
        if (typeof err?.message === 'string' && err.message.length < 300) {
            errorMessage += `\n\n_Error details:_\n${err.message}`;
        }
        ctx.reply(errorMessage, { parse_mode: 'Markdown' });
    }
});
/**
 * /history
 * Shows all historical CA calls/alerts stored in the database
 */
bot.command('history', async (ctx) => {
    const userId = ctx.from.id;
    logger_1.logger.debug('/history command triggered', { userId });
    // Clear any existing session to prevent conflicts
    delete sessions[userId];
    try {
        // Get CA calls from the database (limit to 10 for pagination)
        const calls = await (0, database_1.getAllCACalls)(10); // Get only 10 recent calls
        if (calls.length === 0) {
            ctx.reply('📊 **No Historical CA Calls Found**\n\nCA calls will be automatically stored when detected in the channel.');
            return;
        }
        let historyMessage = `📊 **Recent CA Calls (${calls.length} shown)**\n\n`;
        // Show calls in chronological order (newest first)
        for (const call of calls) {
            const date = call.call_timestamp ? new Date(call.call_timestamp * 1000).toISOString().split('T')[0] : 'Unknown';
            const time = call.call_timestamp ? new Date(call.call_timestamp * 1000).toTimeString().substring(0, 5) : 'Unknown';
            const chainEmoji = call.chain === 'solana' ? '🟣' : call.chain === 'ethereum' ? '🔵' : call.chain === 'bsc' ? '🟡' : '⚪';
            historyMessage += `${chainEmoji} ${date} ${time} | ${call.token_name || 'Unknown'} (${call.token_symbol || 'N/A'})\n`;
            historyMessage += `   Caller: ${call.caller || 'Unknown'} | Price: $${call.call_price?.toFixed(8) || 'N/A'}\n`;
            historyMessage += `   Mint: \`${call.mint.replace(/`/g, '\\`')}\`\n\n`;
        }
        // Add summary and pagination info
        const chains = [...new Set(calls.map((c) => c.chain))];
        const callers = [...new Set(calls.map((c) => c.caller).filter(Boolean))];
        historyMessage += `📈 **Summary:**\n`;
        historyMessage += `• Chains: ${chains.join(', ')}\n`;
        historyMessage += `• Callers: ${callers.length}\n`;
        historyMessage += `• Showing: ${calls.length} recent calls\n\n`;
        historyMessage += `💡 Use \`/backtest_call <mint>\` to run strategy on any call`;
        ctx.reply(historyMessage, { parse_mode: 'Markdown' });
    }
    catch (error) {
        logger_1.logger.error('History command error', error, { userId });
        ctx.reply('❌ Error retrieving historical data. Please try again later.');
    }
});
/**
 * /backtest_call <mint>
 * Run trading strategy on a historical CA call
 */
bot.command('backtest_call', async (ctx) => {
    const userId = ctx.from.id;
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length === 0) {
        ctx.reply('❌ **Usage:** `/backtest_call <mint_address>`\n\nExample: `/backtest_call 0xf73f123Ff5fe61fd94fE0496b35f7bF4eBa84444`');
        return;
    }
    const mint = args[0];
    try {
        // Get the CA call from database
        const call = await (0, database_1.getCACallByMint)(mint);
        if (!call) {
            ctx.reply(`❌ **CA Call Not Found**\n\nNo historical call found for mint: \`${mint.replace(/`/g, '\\`')}\`\n\nUse \`/history\` to see available calls.`);
            return;
        }
        // Start backtest workflow for this historical call
        sessions[userId] = {
            mint: call.mint,
            chain: call.chain,
            metadata: {
                name: call.token_name,
                symbol: call.token_symbol
            },
            datetime: luxon_1.DateTime.fromSeconds(call.call_timestamp),
            strategy: [{ percent: 0.5, target: 2 }, { percent: 0.3, target: 5 }, { percent: 0.2, target: 10 }],
            stopLossConfig: { initial: -0.3, trailing: 0.5 },
            entryConfig: { initialEntry: 'none', trailingEntry: 'none', maxWaitTime: 60 },
            reEntryConfig: { trailingReEntry: 'none', maxReEntries: 0, sizePercent: 0.5 }
        };
        ctx.reply(`🎯 **Backtesting Historical Call**\n\n` +
            `🪙 **${call.token_name}** (${call.token_symbol})\n` +
            `🔗 **Chain**: ${call.chain.toUpperCase()}\n` +
            `📅 **Call Date**: ${new Date(call.call_timestamp * 1000).toLocaleString()}\n` +
            `💰 **Call Price**: $${call.call_price?.toFixed(8) || 'N/A'}\n` +
            `👤 **Caller**: ${call.caller || 'Unknown'}\n\n` +
            `Running simulation with default strategy...`);
        // Run the simulation immediately
        try {
            const alertTime = luxon_1.DateTime.fromSeconds(call.call_timestamp);
            // Pass alertTime for 1m candles around alert time
            const candles = await (0, candles_1.fetchHybridCandles)(call.mint, alertTime, luxon_1.DateTime.utc(), call.chain, alertTime);
            if (!candles.length) {
                ctx.reply('❌ No candle data available for this historical call.');
                delete sessions[userId];
                return;
            }
            const result = (0, engine_1.simulateStrategy)(candles, sessions[userId].strategy, sessions[userId].stopLossConfig, sessions[userId].entryConfig, sessions[userId].reEntryConfig);
            // Format and send results
            const lowestPrice = result.entryOptimization.lowestPrice;
            const lowestPercent = result.entryOptimization.lowestPricePercent;
            const lowestTimeStr = result.entryOptimization.lowestPriceTimeFromEntry < 60
                ? `${result.entryOptimization.lowestPriceTimeFromEntry.toFixed(0)}m`
                : `${(result.entryOptimization.lowestPriceTimeFromEntry / 60).toFixed(1)}h`;
            const chainEmoji = call.chain === 'solana' ? '🟣' : call.chain === 'ethereum' ? '🔵' : call.chain === 'bsc' ? '🟡' : '⚪';
            let resultMessage = `🎯 **Historical Call Backtest Results**\n\n` +
                `${chainEmoji} Chain: ${call.chain.toUpperCase()}\n` +
                `🪙 Token: ${call.token_name || 'Unknown'} (${call.token_symbol || 'N/A'})\n` +
                `📅 Call Date: ${new Date(call.call_timestamp * 1000).toLocaleString()}\n` +
                `👤 Caller: ${call.caller || 'Unknown'}\n` +
                `📈 Candles: ${result.totalCandles}\n` +
                `💰 Simulated PNL: **${result.finalPnl.toFixed(2)}x**\n\n` +
                `🔍 **Entry Optimization:**\n` +
                `• Lowest Price: $${lowestPrice.toFixed(8)} (${lowestPercent.toFixed(1)}%)\n` +
                `• Time to Lowest: ${lowestTimeStr}\n\n` +
                `📋 **Key Events:**\n`;
            // Show key events
            const keyEvents = result.events.filter(e => ['entry', 'target_hit', 'stop_loss', 'final_exit'].includes(e.type));
            for (const event of keyEvents.slice(0, 5)) {
                const eventEmoji = event.type === 'entry' ? '🚀' :
                    event.type === 'target_hit' ? '🎯' :
                        event.type === 'stop_loss' ? '🛑' : '🏁';
                const timestamp = luxon_1.DateTime.fromSeconds(event.timestamp).toFormat('MM-dd HH:mm');
                resultMessage += `${eventEmoji} ${timestamp}: ${event.description}\n`;
            }
            ctx.reply(resultMessage, { parse_mode: 'Markdown' });
            // Save this backtest run
            await (0, database_1.saveSimulationRun)({
                userId: userId,
                mint: call.mint,
                chain: call.chain,
                tokenName: call.token_name,
                tokenSymbol: call.token_symbol,
                strategy: sessions[userId].strategy,
                stopLossConfig: sessions[userId].stopLossConfig,
                startTime: luxon_1.DateTime.fromSeconds(call.call_timestamp),
                endTime: luxon_1.DateTime.utc(),
                finalPnl: result.finalPnl,
                totalCandles: result.totalCandles,
                events: result.events
            });
            delete sessions[userId];
        }
        catch (error) {
            logger_1.logger.error('Backtest call error', error, { userId, mint });
            ctx.reply('❌ Error running backtest on historical call. Please try again later.');
            delete sessions[userId];
        }
    }
    catch (error) {
        logger_1.logger.error('Backtest call command error', error, { userId, mint });
        ctx.reply('❌ Error retrieving historical call. Please try again later.');
    }
});
/**
 * /ichimoku
 * Start Ichimoku Cloud analysis for a token
 * Fetches 52 historical 5-minute candles from Birdeye and starts real-time monitoring
 */
bot.command('ichimoku', ctx => {
    const userId = ctx.from.id;
    logger_1.logger.debug('/ichimoku command triggered', { userId });
    // Clear any existing session to prevent conflicts
    delete sessions[userId];
    sessions[userId] = {
        step: 'waiting_for_mint',
        type: 'ichimoku',
        data: {}
    };
    ctx.reply('📈 **Ichimoku Cloud Analysis**\n\n' +
        'Paste the token address (Solana or EVM) to start Ichimoku monitoring.\n\n' +
        'The bot will:\n' +
        '• Fetch 52 historical 5-minute candles from Birdeye\n' +
        '• Calculate Ichimoku Cloud components\n' +
        '• Start real-time price monitoring\n' +
        '• Send alerts for Ichimoku signals\n\n' +
        'Type `/cancel` to abort.', { parse_mode: 'Markdown' });
});
/**
 * /alert <mint_address>
 * Manually flag a token for monitoring (basic price alerts)
 */
bot.command('alert', async (ctx) => {
    const userId = ctx.from.id;
    const message = ctx.message.text;
    // Extract mint address from command
    const parts = message.split(' ');
    if (parts.length < 2) {
        ctx.reply('❌ **Usage:** `/alert <mint_address>`\n\nExample: `/alert So11111111111111111111111111111111111111112`');
        return;
    }
    const mint = parts[1];
    try {
        // Determine chain based on address format
        let chain = 'solana';
        if (mint.startsWith('0x')) {
            chain = 'ethereum'; // Default to ethereum for 0x addresses
        }
        // Fetch token metadata
        const meta = await axios_1.default.get(`https://public-api.birdeye.so/defi/v3/token/meta-data/single`, {
            headers: {
                'X-API-KEY': process.env.BIRDEYE_API_KEY,
                'accept': 'application/json',
                'x-chain': chain
            },
            params: {
                address: mint
            }
        });
        if (!meta.data.success) {
            ctx.reply(`❌ **Invalid Token Address**\n\nThe address \`${mint}\` is not recognized as a valid token on ${chain.toUpperCase()}.`);
            return;
        }
        const tokenName = meta.data.data.name;
        const tokenSymbol = meta.data.data.symbol;
        // Add to monitoring
        const heliusMonitor = require('./helius-monitor').HeliusMonitor;
        const monitor = new helius_monitor_1.HeliusMonitor(bot);
        await monitor.addCATracking({
            userId: userId,
            chatId: ctx.chat.id,
            mint: mint,
            chain: chain,
            tokenName: tokenName,
            tokenSymbol: tokenSymbol,
            callPrice: 0, // Will be updated with real price
            callTimestamp: Math.floor(Date.now() / 1000),
            strategy: [{ percent: 1, target: 1 }], // Dummy strategy for monitoring
            stopLossConfig: { initial: -0.3, trailing: 'none' }
        });
        ctx.reply(`✅ **Alert Added!**\n\n🪙 **${tokenName}** (${tokenSymbol})\n📍 **Chain:** ${chain.toUpperCase()}\n🔗 **Mint:** \`${mint}\`\n\nThis token is now being monitored for price changes.`);
    }
    catch (error) {
        logger_1.logger.error('Error adding alert', error, { userId, mint });
        ctx.reply('❌ **Error adding alert.** Please check the token address and try again.');
    }
});
/**
 * /alerts
 * Display all tracked tokens and configured alerts in a paginated table
 */
bot.command('alerts', async (ctx) => {
    const userId = ctx.from.id;
    logger_1.logger.debug('/alerts command triggered', { userId });
    // Clear any existing session to prevent conflicts
    delete sessions[userId];
    try {
        const db = require('./database');
        // Get active CA tracking entries
        const activeCAs = await db.getActiveCATracking();
        // Get recent historical CA calls (last 20)
        const recentCalls = await db.getAllCACalls(20);
        if (activeCAs.length === 0 && recentCalls.length === 0) {
            ctx.reply('📊 **No Active Alerts Found**\n\nNo tokens are currently being tracked and no recent CA calls found.\n\nUse `/ichimoku` to start monitoring a token or drop a CA address to begin tracking.');
            return;
        }
        // Combine and format the data
        let alertsMessage = `📊 **Active Alerts & Tracked Tokens**\n\n`;
        // Active CA Tracking Section
        if (activeCAs.length > 0) {
            alertsMessage += `🟢 **Active Tracking (${activeCAs.length})**\n`;
            alertsMessage += `┌─────────────────────────────────────────────────────────────┐\n`;
            alertsMessage += `│ Token Name           │ Chain    │ Price      │ Status        │\n`;
            alertsMessage += `├─────────────────────────────────────────────────────────────┤\n`;
            // Show only first 10 active CAs to avoid message length issues
            const activeCAsToShow = activeCAs.slice(0, 10);
            for (const ca of activeCAsToShow) {
                const chainEmoji = ca.chain === 'solana' ? '🟣' : ca.chain === 'ethereum' ? '🔵' : ca.chain === 'bsc' ? '🟡' : '⚪';
                const tokenName = (ca.token_name || 'Unknown').substring(0, 18).padEnd(18);
                const chain = ca.chain.toUpperCase().substring(0, 7).padEnd(7);
                const price = `$${(ca.call_price || 0).toFixed(6)}`.padEnd(10);
                const status = ca.lastPrice ? '🟢 Live' : '⏳ Pending';
                alertsMessage += `│ ${tokenName} │ ${chain} │ ${price} │ ${status.padEnd(12)} │\n`;
            }
            alertsMessage += `└─────────────────────────────────────────────────────────────┘\n\n`;
            if (activeCAs.length > 10) {
                alertsMessage += `... and ${activeCAs.length - 10} more active trackings\n\n`;
            }
        }
        // Recent CA Calls Section
        if (recentCalls.length > 0) {
            alertsMessage += `📈 **Recent CA Calls (${recentCalls.length})**\n`;
            alertsMessage += `┌─────────────────────────────────────────────────────────────┐\n`;
            alertsMessage += `│ Token Name           │ Chain    │ Price      │ Time          │\n`;
            alertsMessage += `├─────────────────────────────────────────────────────────────┤\n`;
            // Show only first 10 recent calls
            const recentCallsToShow = recentCalls.slice(0, 10);
            for (const call of recentCallsToShow) {
                const chainEmoji = call.chain === 'solana' ? '🟣' : call.chain === 'ethereum' ? '🔵' : call.chain === 'bsc' ? '🟡' : '⚪';
                const tokenName = (call.token_name || 'Unknown').substring(0, 18).padEnd(18);
                const chain = call.chain.toUpperCase().substring(0, 7).padEnd(7);
                const price = `$${(call.call_price || 0).toFixed(6)}`.padEnd(10);
                const time = call.call_timestamp ?
                    new Date(call.call_timestamp * 1000).toLocaleString().substring(0, 12).padEnd(12) :
                    'Unknown'.padEnd(12);
                alertsMessage += `│ ${tokenName} │ ${chain} │ ${price} │ ${time} │\n`;
            }
            alertsMessage += `└─────────────────────────────────────────────────────────────┘\n\n`;
            if (recentCalls.length > 10) {
                alertsMessage += `... and ${recentCalls.length - 10} more recent calls\n\n`;
            }
        }
        // Summary section
        const totalActive = activeCAs.length;
        const totalRecent = recentCalls.length;
        const chains = [...new Set([...activeCAs.map((ca) => ca.chain), ...recentCalls.map((call) => call.chain)])];
        alertsMessage += `📊 **Summary:**\n`;
        alertsMessage += `• Active Trackings: ${totalActive}\n`;
        alertsMessage += `• Recent Calls: ${totalRecent}\n`;
        alertsMessage += `• Chains: ${chains.join(', ')}\n\n`;
        alertsMessage += `💡 **Commands:**\n`;
        alertsMessage += `• \`/ichimoku\` - Start Ichimoku monitoring\n`;
        alertsMessage += `• \`/history\` - View all historical calls\n`;
        alertsMessage += `• Drop a CA address to auto-track`;
        // Send the message
        ctx.reply(alertsMessage, { parse_mode: 'Markdown' });
    }
    catch (error) {
        logger_1.logger.error('Alerts command error', error, { userId });
        ctx.reply('❌ Error retrieving alerts data. Please try again later.');
    }
});
/**
 * /cancel
 * Aborts/clears the user session, halting the simulation workflow.
 */
bot.command('cancel', ctx => {
    const userId = ctx.from.id;
    if (sessions[userId]) {
        delete sessions[userId];
        ctx.reply('✅ **Simulation cancelled!**\n\nSession cleared. Use `/backtest` to start over.');
    }
    else {
        ctx.reply('❌ No active session to cancel.');
    }
});
/**
 * /strategy [subcommand]
 * Manages user strategies.
 * Subcommands:
 *   - (none): List strategies.
 *   - save <name> <desc> <strategy> <stoploss>
 *   - use <name>
 *   - delete <name>
 */
bot.command('strategy', async (ctx) => {
    const userId = ctx.from.id;
    const args = ctx.message.text.split(' ').slice(1);
    try {
        if (args.length === 0) {
            // LIST strategies for this user
            const strategies = await (0, database_1.getUserStrategies)(userId);
            if (strategies.length === 0) {
                ctx.reply('📋 **Your Strategies**\n\nNo custom strategies found.\n\n**Create one:**\n`/strategy save <name> <description> <strategy> <stop_loss>`\n\n**Example:**\n`/strategy save conservative Conservative approach 50@1.5x,50@3x initial: -20%, trailing: 30%`');
                return;
            }
            let message = '📋 **Your Strategies:**\n\n';
            strategies.forEach(strategy => {
                const emoji = strategy.isDefault ? '⭐' : '📊';
                const strategyText = strategy.strategy
                    .map((s) => `${(s.percent * 100).toFixed(0)}%@${s.target}x`)
                    .join(', ');
                const stopText = strategy.stopLossConfig.trailing === 'none'
                    ? `${(strategy.stopLossConfig.initial * 100).toFixed(0)}% initial, none trailing`
                    : `${(strategy.stopLossConfig.initial * 100).toFixed(0)}% initial, ${(strategy.stopLossConfig.trailing * 100).toFixed(0)}% trailing`;
                message += `${emoji} **${strategy.name}**\n`;
                message += `   ${strategy.description || 'No description'}\n`;
                message += `   📈 ${strategyText}\n`;
                message += `   🛑 ${stopText}\n\n`;
            });
            message +=
                '**Usage:**\n`/strategy use <name>` - Use a strategy\n`/strategy delete <name>` - Delete a strategy';
            ctx.reply(message, { parse_mode: 'Markdown' });
        }
        else if (args[0] === 'save') {
            // SAVE a new strategy for the user
            if (args.length < 5) {
                ctx.reply('❌ **Invalid format**\n\n`/strategy save <name> <description> <strategy> <stop_loss>`\n\n**Example:**\n`/strategy save conservative Conservative approach 50@1.5x,50@3x initial: -20%, trailing: 30%`');
                return;
            }
            const name = args[1];
            const description = args[2];
            // Parse strategy and stop loss text
            let strategyText = '';
            let stopLossStartIndex = -1;
            for (let i = 3; i < args.length; i++) {
                if (args[i].startsWith('initial:')) {
                    stopLossStartIndex = i;
                    break;
                }
                if (i > 3)
                    strategyText += ' ';
                strategyText += args[i];
            }
            const stopLossText = stopLossStartIndex >= 0 ? args.slice(stopLossStartIndex).join(' ') : '';
            // Parse take profit strategy steps
            let strategy;
            try {
                if (strategyText.includes('@') && strategyText.includes('x')) {
                    const parts = strategyText.split(',').map(part => part.trim()).filter(Boolean);
                    strategy = parts.map(part => {
                        const [percentStr, targetStr] = part.split('@');
                        if (!percentStr || !targetStr)
                            throw new Error('format');
                        return {
                            percent: parseFloat(percentStr) / 100,
                            target: parseFloat(targetStr.replace('x', '')),
                        };
                    });
                }
                else {
                    ctx.reply('❌ Invalid strategy format. Use: `50@1.5x,50@3x`');
                    return;
                }
            }
            catch {
                ctx.reply('❌ Invalid strategy format. Use: `50@1.5x,50@3x`');
                return;
            }
            // Parse stop loss step
            const stopMatch = stopLossText.match(/initial:\s*(-?\d+(?:\.\d+)?)%?,\s*trailing:\s*(\d+(?:\.\d+)?%?|none)/i);
            if (!stopMatch) {
                ctx.reply('❌ Invalid stop loss format. Use: `initial: -20%, trailing: 30%`');
                return;
            }
            const initialPercent = parseFloat(stopMatch[1]) / 100;
            const trailingValue = stopMatch[2].toLowerCase();
            if (initialPercent >= 0) {
                ctx.reply('❌ Initial stop loss must be negative (e.g., -20%)');
                return;
            }
            let trailingConfig;
            if (trailingValue === 'none') {
                trailingConfig = 'none';
            }
            else {
                const trailingPercent = parseFloat(trailingValue.replace('%', '')) / 100;
                if (trailingPercent <= 0) {
                    ctx.reply('❌ Trailing stop must be positive (e.g., 30%) or "none"');
                    return;
                }
                trailingConfig = trailingPercent;
            }
            const stopLossConfig = { initial: initialPercent, trailing: trailingConfig };
            // Validate total strategy percentages
            const totalPercent = strategy.reduce((sum, step) => sum + step.percent, 0);
            if (Math.abs(totalPercent - 1) > 0.01) {
                ctx.reply(`❌ Strategy percentages must add up to 100%. Total: ${(totalPercent * 100).toFixed(1)}%`);
                return;
            }
            await (0, database_1.saveStrategy)({
                userId,
                name,
                description,
                strategy,
                stopLossConfig,
            });
            ctx.reply(`✅ **Strategy "${name}" saved successfully!**\n\n📈 ${strategyText}\n🛑 ${stopLossText}\n\nUse with: \`/strategy use ${name}\``);
        }
        else if (args[0] === 'use') {
            // USE a previously saved strategy in the next backtest
            if (args.length < 2) {
                ctx.reply('❌ **Usage:** `/strategy use <name>`');
                return;
            }
            const name = args[1];
            const strategy = await (0, database_1.getStrategy)(userId, name);
            if (!strategy) {
                ctx.reply(`❌ Strategy "${name}" not found. Use \`/strategy\` to list your strategies.`);
                return;
            }
            sessions[userId] = {
                ...sessions[userId],
                strategy: strategy.strategy,
                stopLossConfig: strategy.stopLossConfig,
            };
            const strategyText = strategy.strategy
                .map((s) => `${(s.percent * 100).toFixed(0)}%@${s.target}x`)
                .join(', ');
            const stopText = strategy.stopLossConfig.trailing === 'none'
                ? `${(strategy.stopLossConfig.initial * 100).toFixed(0)}% initial, none trailing`
                : `${(strategy.stopLossConfig.initial * 100).toFixed(0)}% initial, ${(strategy.stopLossConfig.trailing * 100).toFixed(0)}% trailing`;
            ctx.reply(`✅ **Strategy "${name}" loaded!**\n\n📈 ${strategyText}\n🛑 ${stopText}\n\nNow use \`/backtest\` to run a simulation with this strategy.`);
        }
        else if (args[0] === 'delete') {
            // DELETE a strategy by name
            if (args.length < 2) {
                ctx.reply('❌ **Usage:** `/strategy delete <name>`');
                return;
            }
            const name = args[1];
            try {
                await (0, database_1.deleteStrategy)(userId, name);
                ctx.reply(`✅ **Strategy "${name}" deleted successfully!**`);
            }
            catch {
                ctx.reply(`❌ Strategy "${name}" not found.`);
            }
        }
        else {
            ctx.reply('❌ **Invalid command**\n\n**Available commands:**\n' +
                '`/strategy` - List strategies\n' +
                '`/strategy save <name> <description> <strategy> <stop_loss>` - Save\n' +
                '`/strategy use <name>` - Use strategy\n' +
                '`/strategy delete <name>` - Delete');
        }
    }
    catch (err) {
        logger_1.logger.error('Strategy command error', err, { userId });
        ctx.reply('❌ An error occurred while processing the strategy command.');
    }
});
// -----------------------------------------------------------------------------
// 4. Ichimoku Workflow Handler
// -----------------------------------------------------------------------------
async function handleIchimokuWorkflow(ctx, session, text) {
    const userId = ctx.from?.id;
    if (!userId)
        return;
    // Step 1: Mint address (detect EVM vs. Solana chain)
    if (!session.mint) {
        session.mint = text;
        if (text.startsWith('0x') && text.length === 42) {
            ctx.reply('🔗 Detected EVM address.\n\nWhich chain?\n1️⃣ Ethereum (ETH)\n2️⃣ Binance Smart Chain (BSC)\n3️⃣ Base (BASE)\n\nReply with: eth, bsc, or base');
            return;
        }
        else {
            session.chain = 'solana';
            await startIchimokuAnalysis(ctx, session);
            return;
        }
    }
    // Step 1.5: For EVM, ask for the specific chain
    if (session.mint && !session.chain) {
        const input = text.toLowerCase();
        if (input === 'eth' || input === 'ethereum') {
            session.chain = 'ethereum';
        }
        else if (input === 'bsc' || input === 'binance') {
            session.chain = 'bsc';
        }
        else if (input === 'base') {
            session.chain = 'base';
        }
        else {
            ctx.reply('❌ Invalid chain. Reply with: eth, bsc, or base');
            return;
        }
        await startIchimokuAnalysis(ctx, session);
        return;
    }
}
async function startIchimokuAnalysis(ctx, session) {
    const userId = ctx.from?.id;
    if (!userId)
        return;
    try {
        await ctx.reply('📈 **Starting Ichimoku Analysis...**\n\nFetching 52 historical 5-minute candles from Birdeye...');
        // Fetch token metadata first
        let tokenName = 'Unknown';
        let tokenSymbol = 'N/A';
        try {
            const meta = await axios_1.default.get(`https://public-api.birdeye.so/defi/v3/token/meta-data/single`, {
                headers: {
                    'X-API-KEY': process.env.BIRDEYE_API_KEY,
                    'accept': 'application/json',
                    'x-chain': session.chain || 'solana'
                },
                params: {
                    address: session.mint
                }
            });
            if (!meta.data.success) {
                const chain = session.chain || 'solana';
                await ctx.reply(`❌ **Invalid Token Address**\n\n` +
                    `The address \`${session.mint}\` is not recognized as a valid token on ${chain.toUpperCase()}.\n\n` +
                    `**Possible reasons:**\n` +
                    `• Not a token mint address\n` +
                    `• Program ID or account address\n` +
                    `• Token doesn't exist\n` +
                    `• Invalid address format\n\n` +
                    `Please verify the address and try again.`);
                delete sessions[userId];
                return;
            }
            tokenName = meta.data.data.name;
            tokenSymbol = meta.data.data.symbol;
        }
        catch (e) {
            logger_1.logger.warn('Could not fetch metadata, using defaults', { mint: session.mint, chain: session.chain });
        }
        // Calculate time range: 52 candles * 5 minutes = 260 minutes = ~4.3 hours
        const endTime = luxon_1.DateTime.now().toUTC();
        const startTime = endTime.minus({ minutes: 260 }); // 52 * 5 minutes
        // Fetch historical candles
        const { fetchHybridCandles } = await Promise.resolve().then(() => __importStar(require('../simulation/candles')));
        let candles;
        try {
            const chain = session.chain || 'solana';
            if (!session.mint) {
                await ctx.reply('❌ Missing token address');
                return;
            }
            candles = await fetchHybridCandles(session.mint, startTime, endTime, chain);
        }
        catch (error) {
            logger_1.logger.error('Candle fetching error', error, { mint: session.mint, chain: session.chain });
            const err = error;
            await ctx.reply(`❌ **Failed to Fetch Historical Data**\n\n` +
                `Error: ${err.response?.data?.message || err.message || 'Unknown error'}\n\n` +
                `**Possible solutions:**\n` +
                `• Verify the token address is correct\n` +
                `• Check if the token has sufficient trading history\n` +
                `• Try a different token\n\n` +
                `The token may not have enough trading data for Ichimoku analysis.`);
            delete sessions[userId];
            return;
        }
        if (candles.length < 52) {
            await ctx.reply(`❌ **Insufficient Historical Data**\n\n` +
                `Only found ${candles.length} candles, need at least 52 for Ichimoku analysis.\n\n` +
                `**This token may:**\n` +
                `• Be too new (less than 4+ hours of trading)\n` +
                `• Have low trading volume\n` +
                `• Not be actively traded\n\n` +
                `Try a token with more trading history.`);
            delete sessions[userId];
            return;
        }
        // Calculate current Ichimoku data
        const { calculateIchimoku, formatIchimokuData } = await Promise.resolve().then(() => __importStar(require('../simulation/ichimoku')));
        const currentIndex = candles.length - 1;
        const ichimokuData = calculateIchimoku(candles, currentIndex);
        if (!ichimokuData) {
            await ctx.reply('❌ **Ichimoku Calculation Failed**\n\nCould not calculate Ichimoku components from the historical data.');
            delete sessions[userId];
            return;
        }
        // Get current price
        const currentPrice = candles[currentIndex].close;
        // Start real-time monitoring with historical candles
        const heliusMonitor = require('./helius-monitor').HeliusMonitor;
        const monitor = new helius_monitor_1.HeliusMonitor(bot);
        // Add CA tracking with pre-loaded historical candles
        const chatId = ctx.chat?.id;
        if (!chatId) {
            await ctx.reply('❌ Unable to get chat ID');
            return;
        }
        const chain = session.chain || 'solana';
        await monitor.addCATrackingWithCandles({
            userId: userId,
            chatId: chatId,
            mint: session.mint,
            chain: chain,
            tokenName: tokenName,
            tokenSymbol: tokenSymbol,
            callPrice: currentPrice,
            callTimestamp: Math.floor(Date.now() / 1000),
            strategy: [{ percent: 1, target: 1 }], // Dummy strategy for monitoring
            stopLossConfig: { initial: -0.3, trailing: 'none' },
            historicalCandles: candles
        });
        // Send initial Ichimoku analysis
        const analysisMessage = `📈 **Ichimoku Analysis Started!**\n\n` +
            `🪙 **${tokenName}** (${tokenSymbol})\n` +
            `🔗 **Chain**: ${chain.toUpperCase()}\n` +
            `💰 **Current Price**: $${currentPrice.toFixed(8)}\n\n` +
            formatIchimokuData(ichimokuData, currentPrice) + `\n\n` +
            `✅ **Real-time monitoring active!**\n` +
            `I'll send alerts when Ichimoku signals are detected.`;
        await ctx.reply(analysisMessage, { parse_mode: 'Markdown' });
        // Clear session
        delete sessions[userId];
    }
    catch (error) {
        logger_1.logger.error('Ichimoku analysis error', error, { userId, mint: session.mint });
        await ctx.reply('❌ **Ichimoku Analysis Failed**\n\nAn error occurred while fetching historical data. Please try again later.');
        delete sessions[userId];
    }
}
// 5. Main Stateful Text Handler (core workflow engine)
// -----------------------------------------------------------------------------
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text.trim();
    const session = sessions[userId];
    // Ignore Telegram commands at this stage: only handle raw user text input from workflow.
    if (text.startsWith('/'))
        return;
    // --- Step: Handle /repeat session, if waiting for user run selection ---
    if (session?.waitingForRunSelection) {
        const selection = text.toLowerCase();
        let selectedRun;
        if (selection === 'last') {
            // Use the OLDEST run (last in array since sorted by most recent first)
            selectedRun = session.recentRuns[session.recentRuns.length - 1];
        }
        else {
            const runIdx = parseInt(selection) - 1;
            if (runIdx >= 0 && runIdx < session.recentRuns.length) {
                selectedRun = session.recentRuns[runIdx];
            }
            else {
                ctx.reply('❌ Invalid selection. Please choose a number from the list or "last" for the oldest.');
                return;
            }
        }
        // Clear selection mode and continue
        sessions[userId] = { ...session, waitingForRunSelection: false, recentRuns: undefined };
        await repeatSimulation(ctx, selectedRun);
        return;
    }
    // --- Step: No active session ‒ attempt CA detection, otherwise ignore other text ---
    if (!session) {
        if (await detectCADrop(ctx, text))
            return;
        return;
    }
    // --- Workflow: Active session, progress through simulation input steps ---
    // Handle Ichimoku workflow
    if (session.type === 'ichimoku') {
        await handleIchimokuWorkflow(ctx, session, text);
        return;
    }
    // Step 1: Mint address (detect EVM vs. Solana chain)
    if (!session.mint) {
        session.mint = text;
        // Enhanced: Check if this token has been called before
        try {
            logger_1.logger.debug('Checking database for token', { text });
            const calls = await (0, caller_database_1.findCallsForToken)(text);
            logger_1.logger.debug('Found calls in database', { callCount: calls.length, text });
            if (calls.length > 0) {
                // Found calls! Use the most recent one
                const latestCall = calls[0];
                session.chain = latestCall.chain;
                session.datetime = luxon_1.DateTime.fromISO(latestCall.alert_timestamp);
                session.callerInfo = latestCall;
                const date = new Date(latestCall.alert_timestamp).toISOString().split('T')[0];
                const time = new Date(latestCall.alert_timestamp).toTimeString().substring(0, 5);
                const chainEmoji = latestCall.chain === 'solana' ? '🟣' : latestCall.chain === 'ethereum' ? '🔵' : latestCall.chain === 'bsc' ? '🟡' : '⚪';
                ctx.reply(`✨ **Found ${calls.length} previous call(s)!**\n\n🎯 **Using most recent call:**\n${chainEmoji} **${latestCall.caller_name}** - ${date} ${time}\nToken: ${latestCall.token_symbol || 'N/A'}\nChain: ${latestCall.chain}\n\n**Take Profit Strategy:**\n• \`yes\` - Default: 50%@2x, 30%@5x, 20%@10x\n• \`50@2x,30@5x,20@10x\` - Custom format\n• \`[{"percent":0.5,"target":2}]\` - JSON format`);
                return;
            }
        }
        catch (error) {
            logger_1.logger.error('Error checking database for calls', error, { text });
        }
        // No calls found or error - proceed with manual datetime input
        if (text.startsWith('0x') && text.length === 42) {
            ctx.reply('🔗 Detected EVM address.\n\nWhich chain?\n1️⃣ Ethereum (ETH)\n2️⃣ Binance Smart Chain (BSC)\n3️⃣ Base (BASE)\n\nReply with: eth, bsc, or base');
            return;
        }
        else {
            session.chain = 'solana';
            ctx.reply('Got the mint. Please provide a simulation start datetime (ISO, e.g. 2025-10-17T03:00:00Z).');
            return;
        }
    }
    // Step 1.5: For EVM, ask for the specific chain
    if (session.mint && !session.chain) {
        const input = text.toLowerCase();
        if (input === 'eth' || input === 'ethereum') {
            session.chain = 'ethereum';
        }
        else if (input === 'bsc' || input === 'binance') {
            session.chain = 'bsc';
        }
        else if (input === 'base') {
            session.chain = 'base';
        }
        else {
            ctx.reply('❌ Invalid chain. Reply with: eth, bsc, or base');
            return;
        }
        ctx.reply('Got the chain. Please provide a simulation start datetime (ISO format, e.g. 2025-10-17T03:00:00Z).');
        return;
    }
    // Step 2: Simulation entry date/time
    if (!session.datetime) {
        const dt = luxon_1.DateTime.fromISO(text, { zone: 'utc' });
        if (!dt.isValid) {
            ctx.reply('Invalid datetime. Use ISO format like 2025-10-17T03:00:00Z.');
            return;
        }
        session.datetime = dt;
        sessions[userId] = session;
        try {
            // Fetch token metadata from Birdeye for info/lookup
            logger_1.logger.debug('Fetching metadata for mint', { mint: session.mint });
            const meta = await axios_1.default.get(`https://public-api.birdeye.so/defi/v3/token/meta-data/single`, {
                headers: {
                    'X-API-KEY': process.env.BIRDEYE_API_KEY,
                    'accept': 'application/json',
                    'x-chain': session.chain || 'solana'
                },
                params: {
                    address: session.mint
                }
            });
            logger_1.logger.debug('Metadata response', { mint: session.mint, hasData: !!meta.data });
            session.metadata = meta.data.data;
            ctx.reply(`🪙 Token: ${meta.data.data.name} (${meta.data.data.symbol})\n\n**Take Profit Strategy:**\n• \`yes\` - Default: 50%@2x, 30%@5x, 20%@10x\n• \`50@2x,30@5x,20@10x\` - Custom format\n• \`[{"percent":0.5,"target":2}]\` - JSON format`);
        }
        catch (e) {
            const err = e;
            logger_1.logger.error('Token metadata error', e, { status: err.response?.status, mint: session.mint });
            if (err.response?.status === 404) {
                ctx.reply(`⚠️ Token not found on Birdeye: ${session.mint}\n\n**Take Profit Strategy:**\n• \`yes\` - Default: 50%@2x, 30%@5x, 20%@10x\n• \`50@2x,30@5x,20@10x\` - Custom format\n• \`[{"percent":0.5,"target":2}]\` - JSON format`);
                session.metadata = { name: 'Unknown', symbol: 'N/A' };
            }
            else {
                ctx.reply('❌ Failed to fetch token metadata. Check mint address or try again later.');
                return;
            }
        }
        return;
    }
    // Step 3: Take profit strategy configuration
    if (!session.strategy) {
        if (text.toLowerCase() === 'yes') {
            session.strategy = DEFAULT_STRATEGY;
        }
        else {
            // Parse either the simple or JSON format
            try {
                let custom;
                if (text.includes('@') && text.includes('x')) {
                    const parts = text.split(',').map(part => part.trim());
                    custom = parts.map(part => {
                        const [percentStr, targetStr] = part.split('@');
                        const percent = parseFloat(percentStr) / 100;
                        const target = parseFloat(targetStr.replace('x', ''));
                        return { percent, target };
                    });
                }
                else {
                    custom = JSON.parse(text);
                    if (!Array.isArray(custom))
                        throw new Error();
                }
                const totalPercent = custom.reduce((sum, step) => sum + step.percent, 0);
                if (Math.abs(totalPercent - 1) > 0.01) {
                    ctx.reply(`❌ Strategy percentages must add up to 100%. Current total: ${(totalPercent * 100).toFixed(1)}%\n\nTry: "50@2x,30@5x,20@10x" or "yes" for default`);
                    return;
                }
                session.strategy = custom;
            }
            catch {
                ctx.reply('❌ Invalid strategy format.\n\n**Simple format:** `50@2x,30@5x,20@10x`\n**JSON format:** `[{"percent":0.5,"target":2}]`\n**Default:** `yes`');
                return;
            }
        }
        sessions[userId] = session;
        ctx.reply('✅ Take profit strategy set!\n\n**Stop Loss Configuration:**\nFormat: `initial: -30%, trailing: 50%`\n\nExamples:\n• `initial: -20%, trailing: 30%`\n• `initial: -50%, trailing: 100%`\n• `initial: -30%, trailing: none`\n• `default` - Use default (-50% initial, 50% trailing)\n\n*Next: Re-entry configuration*');
        return;
    }
    // Step 4: Stop loss configuration
    if (!session.stopLossConfig) {
        if (text.toLowerCase() === 'default') {
            session.stopLossConfig = { initial: -0.5, trailing: 0.5 };
        }
        else {
            // Parse "initial: -30%, trailing: 50%" or "...: none"
            try {
                const match = text.match(/initial:\s*(-?\d+(?:\.\d+)?)%?,\s*trailing:\s*(\d+(?:\.\d+)?%?|none)/i);
                if (!match) {
                    ctx.reply('❌ Invalid stop loss format.\n\n**Format:** `initial: -30%, trailing: 50%`\n**Examples:**\n• `initial: -20%, trailing: 30%`\n• `initial: -50%, trailing: 100%`\n• `initial: -30%, trailing: none`\n• `default`');
                    return;
                }
                const initialPercent = parseFloat(match[1]) / 100;
                const trailingValue = match[2].toLowerCase();
                if (initialPercent >= 0) {
                    ctx.reply('❌ Initial stop loss must be negative (e.g., -30%)');
                    return;
                }
                let trailingConfig;
                if (trailingValue === 'none') {
                    trailingConfig = 'none';
                }
                else {
                    const trailingPercent = parseFloat(trailingValue.replace('%', '')) / 100;
                    if (trailingPercent <= 0) {
                        ctx.reply('❌ Trailing stop must be positive (e.g., 50%) or "none"');
                        return;
                    }
                    trailingConfig = trailingPercent;
                }
                session.stopLossConfig = { initial: initialPercent, trailing: trailingConfig };
            }
            catch {
                ctx.reply('❌ Invalid stop loss format.\n\n**Format:** `initial: -30%, trailing: 50%`\n**Examples:**\n• `initial: -20%, trailing: 30%`\n• `initial: -50%, trailing: 100%`\n• `initial: -30%, trailing: none`\n• `default`');
                return;
            }
        }
    }
    // After stop loss is set, check if we need to prompt or parse re-entry
    if (session.stopLossConfig && !session.reEntryConfig) {
        // Check if this input looks like re-entry configuration
        const input = text.toLowerCase();
        if (input === 'disable' || input === 'no' || input.startsWith('enable:')) {
            // This is re-entry input, parse it
            if (input === 'disable' || input === 'no') {
                session.reEntryConfig = { trailingReEntry: 'none', maxReEntries: 0, sizePercent: 0.5 };
            }
            else if (input.startsWith('enable:')) {
                const match = input.match(/enable:\s*(\d+)%/);
                if (match) {
                    const retracePercent = parseFloat(match[1]) / 100;
                    session.reEntryConfig = { trailingReEntry: retracePercent, maxReEntries: 1, sizePercent: 0.5 };
                }
                else {
                    ctx.reply('❌ Invalid re-entry format.\n\n**Format:** \`enable: <percentage>%\`\n**Examples:**\n• \`enable: 30%\`\n• \`enable: 50%\`\n• \`enable: 60%\`\n• \`disable\`');
                    return;
                }
            }
            sessions[userId] = session;
        }
        else {
            // This is NOT re-entry input yet, prompt for it
            sessions[userId] = session;
            ctx.reply('✅ Stop loss configured!\n\n**Re-entry Configuration:**\nFormat: `enable: <percentage>%`\n\nExamples:\n• `enable: 30%` - Allow re-entry after 30% retrace from peak\n• `enable: 70%` - Allow re-entry after 70% retrace from peak\n• `disable` - No re-entry after stop loss');
            return;
        }
    }
    // Check if all configs are set and we're ready to start simulation
    if (session.stopLossConfig && session.reEntryConfig) {
        // All workflow input received: kick off simulation
        ctx.reply('✅ All configurations set!\n\nFetching token data and running simulation...');
        try {
            // Download candles for token from start date forward (hybrid granularity)
            // Pass session.datetime as alertTime for 1m candles around alert time
            let candles = await (0, candles_1.fetchHybridCandles)(session.mint, session.datetime, luxon_1.DateTime.utc(), session.chain || 'solana', session.datetime);
            if (!candles.length) {
                ctx.reply('❌ No candle data returned.');
                return;
            }
            // Run strategy simulation against data using gathered workflow config
            const result = (0, engine_1.simulateStrategy)(candles, session.strategy, session.stopLossConfig, session.entryConfig, session.reEntryConfig);
            // Compose a simulation result summary with core metrics, summary, and first 10 events
            const chainEmoji = session.chain === 'ethereum' ? '⟠' : session.chain === 'bsc' ? '🟡' : session.chain === 'base' ? '🔵' : '◎';
            const stopConfig = session.stopLossConfig || { initial: -0.5, trailing: 0.5 };
            // Sim entry optimization
            const lowestPrice = result.entryOptimization.lowestPrice;
            const lowestPercent = result.entryOptimization.lowestPricePercent;
            const lowestTime = result.entryOptimization.lowestPriceTimeFromEntry;
            const lowestTimeStr = lowestTime < 60 ? `${lowestTime.toFixed(0)}m` : `${(lowestTime / 60).toFixed(1)}h`;
            let resultMessage = `📊 **Simulation Results**\n\n` +
                `${chainEmoji} Chain: ${session.chain?.toUpperCase() || 'SOLANA'}\n` +
                `🪙 Token: ${session.metadata?.name || 'Unknown'} (${session.metadata?.symbol || 'N/A'})\n` +
                `📅 Period: ${session.datetime.toFormat('yyyy-MM-dd HH:mm')} - ${luxon_1.DateTime.utc().toFormat('yyyy-MM-dd HH:mm')}\n` +
                `📈 Candles: ${result.totalCandles}\n` +
                `🛑 Stop Loss: ${(stopConfig.initial * 100).toFixed(0)}% initial, ${stopConfig.trailing === 'none' ? 'none' : `${(stopConfig.trailing * 100).toFixed(0)}%`} trailing\n` +
                `🔄 Re-entry: ${(() => {
                    const reEntryCfg = session.reEntryConfig || { trailingReEntry: 'none', maxReEntries: 0, sizePercent: 0.5 };
                    if (reEntryCfg.trailingReEntry === 'none')
                        return 'disabled';
                    return `enabled (${(reEntryCfg.trailingReEntry * 100).toFixed(0)}% retrace, max ${reEntryCfg.maxReEntries})`;
                })()}\n` +
                `💰 Simulated PNL: **${result.finalPnl.toFixed(2)}x**\n\n` +
                `🔍 **Entry Optimization:**\n` +
                `• Lowest Price: $${lowestPrice.toFixed(8)} (${lowestPercent.toFixed(1)}%) at ${luxon_1.DateTime.fromSeconds(result.entryOptimization.lowestPriceTimestamp).toFormat('MM-dd HH:mm')}\n` +
                `• Time to Lowest: ${lowestTimeStr}\n\n` +
                `📋 **Simulation Events:**\n`;
            // Limit to top 10 events in message, summarize rest
            const maxEvents = 10;
            const eventsToShow = result.events.slice(0, maxEvents);
            for (const event of eventsToShow) {
                const eventEmoji = event.type === 'entry' ? '🚀' :
                    event.type === 'stop_moved' ? '🛡️' :
                        event.type === 'target_hit' ? '🎯' :
                            event.type === 'stop_loss' ? '🛑' :
                                event.type === 're_entry' ? '🔄' :
                                    event.type === 'trailing_entry_triggered' ? '⏰' : '🏁';
                const timestamp = luxon_1.DateTime.fromSeconds(event.timestamp).toFormat('MM-dd HH:mm');
                resultMessage += `${eventEmoji} ${timestamp}: ${event.description}\n`;
                if (event.type !== 'entry') {
                    resultMessage += `   PNL: ${event.pnlSoFar.toFixed(2)}x | Position: ${(event.remainingPosition * 100).toFixed(0)}%\n`;
                }
            }
            if (result.events.length > maxEvents) {
                resultMessage += `\n... and ${result.events.length - maxEvents} more events\n`;
            }
            ctx.reply(resultMessage, { parse_mode: 'Markdown' });
            // Save simulation run for future /repeat, analytics, and user history.
            try {
                await (0, database_1.saveSimulationRun)({
                    userId,
                    mint: session.mint,
                    chain: session.chain || 'solana',
                    tokenName: session.metadata?.name,
                    tokenSymbol: session.metadata?.symbol,
                    startTime: session.datetime,
                    endTime: luxon_1.DateTime.utc(),
                    strategy: session.strategy,
                    stopLossConfig: session.stopLossConfig,
                    finalPnl: result.finalPnl,
                    totalCandles: result.totalCandles,
                    events: result.events
                });
                logger_1.logger.info('Saved simulation run', { userId });
            }
            catch (err) {
                logger_1.logger.error('Failed to save simulation run', err, { userId });
            }
            // Optionally broadcast result to a group/channel for admin/analytics
            // DISABLED to prevent duplicate messages
            // if (DEFAULT_CHAT_ID) {
            //   try {
            //     await bot.telegram.sendMessage(DEFAULT_CHAT_ID, resultMessage, { parse_mode: 'Markdown' });
            //   } catch (err) {
            //     console.error('Failed to send to default chat:', err);
            //   }
            // }
            // End session
            delete sessions[userId];
        }
        catch (e) {
            ctx.reply('❌ Failed to fetch candles or simulate.');
            logger_1.logger.error('Simulation error', e, { userId, mint: session.mint });
        }
        return;
    }
});
// -----------------------------------------------------------------------------
// 5. CA Drop Detection & Tracking
// -----------------------------------------------------------------------------
/**
 * Detects contract address (CA) drops in free-form user text.
 * Returns true if any CA was detected/processed, otherwise false.
 */
async function detectCADrop(ctx, text) {
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
    logger_1.logger.debug('Potential CA drop detected', { addresses });
    // Process all CA(s) found in message
    for (const address of addresses) {
        try {
            await processCADrop(ctx, address);
        }
        catch (error) {
            logger_1.logger.error('Error processing CA drop', error, { address });
        }
    }
    return true;
}
/**
 * Handles CA registration + monitoring.
 * Identifies chain, fetches meta, logs and monitors (if enabled).
 */
async function processCADrop(ctx, address) {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) {
        await ctx.reply('❌ Unable to get user or chat ID');
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
                        tokenData = meta.data.data ?? undefined;
                        if (tokenData && typeof tokenData === 'object' && 'name' in tokenData) {
                            finalChain = tryChain;
                            // @ts-ignore: we're confident tokenData has 'name'
                            logger_1.logger.debug('Found token on chain', { chain: tryChain, tokenName: tokenData.name, address });
                            break;
                        }
                    }
                }
                catch (err) {
                    // If error fetching on this chain, try next
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
        const currentPrice = tokenData?.price || 0;
        const marketcap = tokenData?.mc || 0;
        // Always use default strategy/SL for auto CA monitoring
        const strategy = DEFAULT_STRATEGY;
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
        // Compose confirmation message to user/chat
        const chainEmoji = finalChain === 'ethereum' ? '⟠' : finalChain === 'bsc' ? '🟡' : finalChain === 'base' ? '🔵' : '◎';
        const monitoringStatus = finalChain === 'solana' ? '✅ Real-time monitoring active!' : '⚠️ Real-time monitoring not available for this chain';
        const message = `🎯 **CA Drop Detected & Tracking Started!**\n\n` +
            `${chainEmoji} Chain: ${finalChain.toUpperCase()}\n` +
            `🪙 Token: ${tokenData.name} (${tokenData.symbol})\n` +
            `💰 Price: $${currentPrice.toFixed(8)}\n` +
            `📊 Market Cap: $${(marketcap / 1000000).toFixed(2)}M\n` +
            `📈 Strategy: 50%@2x, 30%@5x, 20%@10x\n` +
            `🛑 Stop Loss: -50% initial, 50% trailing\n\n` +
            `${monitoringStatus}`;
        await ctx.reply(message, { parse_mode: 'Markdown' });
        logger_1.logger.info('Started tracking CA', { tokenName: tokenData.name, address, chain: finalChain });
    }
    catch (error) {
        logger_1.logger.error('Error fetching token metadata for CA', error, { address });
        // On errors during CA detection, fail silently to avoid chat spam
    }
}
// -----------------------------------------------------------------------------
// 6. Bot Startup and Persistent Services
// -----------------------------------------------------------------------------
/**
 * Main entrypoint: initializes the database, starts external services, and launches the bot.
 */
async function startBot() {
    try {
        await (0, database_1.initDatabase)();
        logger_1.logger.info('Database initialized successfully');
        // Start Helius monitor if enabled
        if (process.env.HELIUS_API_KEY && process.env.HELIUS_API_KEY.trim() !== '') {
            try {
                heliusMonitor = new helius_monitor_1.HeliusMonitor(bot);
                await heliusMonitor.start();
                logger_1.logger.info('Helius monitoring started');
            }
            catch (error) {
                const err = error;
                logger_1.logger.warn('Helius monitoring failed to start', { error: err.message || String(error) });
                logger_1.logger.info('Continuing without real-time CA monitoring...');
                if (heliusMonitor) {
                    heliusMonitor.stop();
                }
                heliusMonitor = null;
            }
        }
        else {
            logger_1.logger.info('HELIUS_API_KEY not found or empty - CA monitoring disabled');
        }
        await startRecorderServices();
        // Start receiving messages
        bot.launch();
        logger_1.logger.info('Bot running...');
    }
    catch (err) {
        logger_1.logger.error('Failed to initialize database', err);
        process.exit(1);
    }
}
startBot();
async function startRecorderServices() {
    if (!process.env.HELIUS_API_KEY || process.env.HELIUS_API_KEY.trim() === '') {
        logger_1.logger.info('Helius recorder disabled - missing API key');
        return;
    }
    try {
        await helius_recorder_1.heliusStreamRecorder.start();
        logger_1.logger.info('Helius stream recorder started');
    }
    catch (error) {
        logger_1.logger.error('Failed to start Helius stream recorder', error);
    }
    try {
        await scheduleInitialBackfillJobs();
        helius_backfill_service_1.heliusBackfillService.start();
    }
    catch (error) {
        logger_1.logger.error('Failed to schedule backfill jobs', error);
    }
    try {
        await pumpfun_lifecycle_tracker_1.pumpfunLifecycleTracker.start();
        logger_1.logger.info('Pumpfun lifecycle tracker started');
    }
    catch (error) {
        logger_1.logger.error('Failed to start Pumpfun lifecycle tracker', error);
    }
}
async function scheduleInitialBackfillJobs() {
    const tokens = await (0, database_1.getTrackedTokens)();
    if (tokens.length === 0) {
        logger_1.logger.info('No tokens available for backfill scheduling');
        return;
    }
    const now = luxon_1.DateTime.utc();
    tokens.forEach((token) => {
        helius_backfill_service_1.heliusBackfillService.enqueue({
            mint: token.mint,
            chain: token.chain,
            startTime: now.minus({ minutes: 15 }),
            endTime: now,
            priority: token.source === 'ca_tracking' ? 2 : 1,
        });
    });
    logger_1.logger.info('Scheduled initial Helius backfill jobs', { tokenCount: tokens.length });
}
//# sourceMappingURL=bot.js.map