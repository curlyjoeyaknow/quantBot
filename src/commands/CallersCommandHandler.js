"use strict";
/**
 * Callers Command Handler
 * =======================
 * Handles the /callers command for showing top callers statistics
 * and database statistics.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CallersCommandHandler = void 0;
const CommandHandler_1 = require("./interfaces/CommandHandler");
const caller_database_1 = require("../utils/caller-database");
const logger_1 = require("../utils/logger");
class CallersCommandHandler extends CommandHandler_1.BaseCommandHandler {
    constructor() {
        super(...arguments);
        this.command = 'callers';
    }
    async execute(ctx, session) {
        try {
            await ctx.reply('📊 **Loading caller statistics...**');
            const { stats, topCallers } = await (0, caller_database_1.getCallerStats)();
            if (!stats) {
                await ctx.reply('❌ Error loading caller statistics.');
                return;
            }
            let message = `📊 **Caller Database Statistics**\n\n`;
            message += `🗄️ **Database Stats:**\n`;
            message += `• Total alerts: ${stats.total_alerts}\n`;
            message += `• Total callers: ${stats.total_callers}\n`;
            message += `• Total tokens: ${stats.total_tokens}\n`;
            message += `• Date range: ${stats.earliest_alert?.split('T')[0]} to ${stats.latest_alert?.split('T')[0]}\n\n`;
            message += `🏆 **Top 10 Callers:**\n`;
            topCallers.forEach((caller, index) => {
                message += `${index + 1}. **${caller.caller_name}** - ${caller.alert_count} alerts, ${caller.token_count} tokens\n`;
            });
            message += `\n💡 **Use \`/calls <mint>\` to see calls for a specific token!**`;
            await ctx.reply(message, { parse_mode: 'Markdown' });
        }
        catch (error) {
            logger_1.logger.error('Callers command error', error, { userId: ctx.from?.id });
            await this.sendError(ctx, '❌ Error loading caller statistics. Please try again later.');
        }
    }
}
exports.CallersCommandHandler = CallersCommandHandler;
//# sourceMappingURL=CallersCommandHandler.js.map