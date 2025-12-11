"use strict";
/**
 * History Command Handler
 * =======================
 * Handles the /history command for showing historical CA calls/alerts
 * stored in the database.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HistoryCommandHandler = void 0;
const CommandHandler_1 = require("./interfaces/CommandHandler");
const database_1 = require("../utils/database");
const logger_1 = require("../utils/logger");
class HistoryCommandHandler extends CommandHandler_1.BaseCommandHandler {
    constructor() {
        super(...arguments);
        this.command = 'history';
    }
    async execute(ctx, session) {
        const userId = ctx.from?.id;
        if (!userId) {
            await this.sendError(ctx, 'Unable to identify user.');
            return;
        }
        logger_1.logger.debug('/history command triggered', { userId });
        try {
            // Get all CA drops from database (limit to 10 for pagination)
            const caDrops = await (0, database_1.getAllCACalls)(10);
            if (caDrops.length === 0) {
                await ctx.reply('📊 **No Historical CA Calls Found**\n\nCA calls will be automatically stored when detected in the channel.');
                return;
            }
            let historyMessage = `📊 **Recent CA Calls (${caDrops.length} shown)**\n\n`;
            // Show calls in chronological order (newest first)
            for (const call of caDrops) {
                const date = call.call_timestamp ? new Date(call.call_timestamp * 1000).toISOString().split('T')[0] : 'Unknown';
                const time = call.call_timestamp ? new Date(call.call_timestamp * 1000).toTimeString().substring(0, 5) : 'Unknown';
                const chainEmoji = call.chain === 'solana' ? '🟣' : call.chain === 'ethereum' ? '🔵' : call.chain === 'bsc' ? '🟡' : '⚪';
                historyMessage += `${chainEmoji} ${date} ${time} | ${call.token_name || 'Unknown'} (${call.token_symbol || 'N/A'})\n`;
                historyMessage += `   Caller: ${call.caller || 'Unknown'} | Price: $${call.call_price?.toFixed(8) || 'N/A'}\n`;
                historyMessage += `   Mint: \`${call.mint.replace(/`/g, '\\`')}\`\n\n`;
            }
            // Add summary and pagination info
            const chains = [...new Set(caDrops.map((c) => c.chain))];
            const callers = [...new Set(caDrops.map((c) => c.caller).filter(Boolean))];
            historyMessage += `📈 **Summary:**\n`;
            historyMessage += `• Chains: ${chains.join(', ')}\n`;
            historyMessage += `• Callers: ${callers.length}\n`;
            historyMessage += `• Showing: ${caDrops.length} recent calls\n\n`;
            historyMessage += `💡 Use \`/backtest_call <mint>\` to run strategy on any call`;
            await ctx.reply(historyMessage, { parse_mode: 'Markdown' });
        }
        catch (error) {
            logger_1.logger.error('History command error', error, { userId });
            await ctx.reply('❌ Error retrieving historical data. Please try again later.');
        }
    }
}
exports.HistoryCommandHandler = HistoryCommandHandler;
//# sourceMappingURL=HistoryCommandHandler.js.map