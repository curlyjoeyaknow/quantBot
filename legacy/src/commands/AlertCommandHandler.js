"use strict";
/**
 * Alert Command Handler
 * ====================
 * Handles the /alert command for manually flagging tokens for monitoring
 * and basic price alerts.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AlertCommandHandler = void 0;
const CommandHandler_1 = require("./interfaces/CommandHandler");
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
class AlertCommandHandler extends CommandHandler_1.BaseCommandHandler {
    constructor() {
        super(...arguments);
        this.command = 'alert';
    }
    async execute(ctx, session) {
        const userId = ctx.from?.id;
        if (!userId) {
            await this.sendError(ctx, 'Unable to identify user.');
            return;
        }
        // Parse command arguments
        const message = 'text' in (ctx.message ?? {}) ? ctx.message.text : '';
        const parts = message.split(' ');
        if (parts.length < 2) {
            await ctx.reply('❌ **Usage:** `/alert <mint_address>`\n\n' +
                'Example: `/alert So11111111111111111111111111111111111111112`');
            return;
        }
        const mint = parts[1];
        let chain = 'solana'; // Declare outside try block for catch access
        try {
            // Determine chain based on address format
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
                await ctx.reply(`❌ **Invalid Token Address**\n\n` +
                    `The address \`${mint}\` is not recognized as a valid token on ${chain.toUpperCase()}.`, { parse_mode: 'Markdown' });
                return;
            }
            const tokenName = meta.data.data.name;
            const tokenSymbol = meta.data.data.symbol;
            // Add to monitoring
            const heliusMonitor = require('../helius-monitor').HeliusMonitor;
            const monitor = new heliusMonitor(ctx.telegram);
            await monitor.addCATracking({
                userId: userId,
                chatId: ctx.chat?.id || 0,
                mint: mint,
                chain: chain,
                tokenName: tokenName,
                tokenSymbol: tokenSymbol,
                callPrice: 0, // Will be updated with real price
                callTimestamp: Math.floor(Date.now() / 1000),
                strategy: [{ percent: 1, target: 1 }], // Dummy strategy for monitoring
                stopLossConfig: { initial: -0.3, trailing: 'none' }
            });
            await ctx.reply(`✅ **Alert Added!**\n\n` +
                `🪙 **${tokenName}** (${tokenSymbol})\n` +
                `📍 **Chain:** ${chain.toUpperCase()}\n` +
                `🔗 **Mint:** \`${mint}\`\n\n` +
                `This token is now being monitored for price changes.`, { parse_mode: 'Markdown' });
        }
        catch (error) {
            logger_1.logger.error('Error adding alert', error, { userId, mint: mint || 'unknown', chain: chain || 'unknown' });
            await this.sendError(ctx, '❌ **Error adding alert.** Please check the token address and try again.');
        }
    }
}
exports.AlertCommandHandler = AlertCommandHandler;
//# sourceMappingURL=AlertCommandHandler.js.map