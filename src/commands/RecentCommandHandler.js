"use strict";
/**
 * Recent Command Handler
 * ======================
 * Handles the /recent command for showing recent CA calls
 * from the database.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecentCommandHandler = void 0;
const CommandHandler_1 = require("./interfaces/CommandHandler");
const caller_database_1 = require("../utils/caller-database");
const logger_1 = require("../utils/logger");
class RecentCommandHandler extends CommandHandler_1.BaseCommandHandler {
    constructor() {
        super(...arguments);
        this.command = 'recent';
    }
    async execute(ctx, session) {
        try {
            await ctx.reply('📊 **Loading recent calls...**');
            const calls = await (0, caller_database_1.getRecentCalls)(15);
            if (calls.length === 0) {
                await ctx.reply('📊 **No Recent Calls Found**\n\nNo calls found in the database.');
                return;
            }
            let message = `📊 **Recent Calls (${calls.length} shown)**\n\n`;
            calls.forEach((call, index) => {
                const date = new Date(call.alert_timestamp).toISOString().split('T')[0];
                const time = new Date(call.alert_timestamp).toTimeString().substring(0, 5);
                const chainEmoji = call.chain === 'solana' ? '🟣' :
                    call.chain === 'ethereum' ? '🔵' :
                        call.chain === 'bsc' ? '🟡' : '⚪';
                message += `${index + 1}. ${chainEmoji} **${call.caller_name}** - ${date} ${time}\n`;
                message += `   Token: ${call.token_symbol || 'N/A'} | Chain: ${call.chain}\n`;
                message += `   Mint: \`${call.token_address}\`\n\n`;
            });
            message += `💡 **Use \`/backtest\` and paste any mint to run simulation!**`;
            await ctx.reply(message, { parse_mode: 'Markdown' });
        }
        catch (error) {
            logger_1.logger.error('Recent command error', error, { userId: ctx.from?.id });
            await this.sendError(ctx, '❌ Error retrieving recent calls. Please try again later.');
        }
    }
}
exports.RecentCommandHandler = RecentCommandHandler;
//# sourceMappingURL=RecentCommandHandler.js.map