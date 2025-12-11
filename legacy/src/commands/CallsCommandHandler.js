"use strict";
/**
 * Calls Command Handler
 * =====================
 * Handles the /calls command for showing all historical calls for a specific token.
 * Displays caller name, timestamp, price, chain info.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CallsCommandHandler = void 0;
const CommandHandler_1 = require("./interfaces/CommandHandler");
const caller_database_1 = require("../utils/caller-database");
const logger_1 = require("../utils/logger");
class CallsCommandHandler extends CommandHandler_1.BaseCommandHandler {
    constructor() {
        super(...arguments);
        this.command = 'calls';
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
            await ctx.reply('❌ **Usage:** `/calls <mint_address>`\n\n' +
                'Example: `/calls So11111111111111111111111111111111111111112`');
            return;
        }
        const mint = parts[1];
        try {
            await ctx.reply('🔍 **Searching for calls...**');
            const calls = await (0, caller_database_1.findCallsForToken)(mint);
            if (calls.length === 0) {
                await ctx.reply(`📊 **No Calls Found**\n\n` +
                    `No calls found for token: \`${mint}\`\n\n` +
                    `This token hasn't been called by any of our tracked callers.`, { parse_mode: 'Markdown' });
                return;
            }
            let resultMessage = `📊 **Found ${calls.length} calls for this token:**\n\n`;
            calls.forEach((call, index) => {
                const date = new Date(call.alert_timestamp).toISOString().split('T')[0];
                const time = new Date(call.alert_timestamp).toTimeString().substring(0, 5);
                const chainEmoji = call.chain === 'solana' ? '🟣' :
                    call.chain === 'ethereum' ? '🔵' :
                        call.chain === 'bsc' ? '🟡' : '⚪';
                resultMessage += `${index + 1}. ${chainEmoji} **${call.caller_name}** - ${date} ${time}\n`;
                resultMessage += `   Token: ${call.token_symbol || 'N/A'} | Chain: ${call.chain}\n`;
                resultMessage += `   Mint: \`${call.token_address}\`\n\n`;
            });
            resultMessage += `💡 **Use \`/backtest\` and paste the mint to run simulation with original call time!**`;
            await ctx.reply(resultMessage, { parse_mode: 'Markdown' });
        }
        catch (error) {
            logger_1.logger.error('Calls command error', error, { userId, mint });
            await this.sendError(ctx, '❌ Error retrieving calls. Please try again later.');
        }
    }
}
exports.CallsCommandHandler = CallsCommandHandler;
//# sourceMappingURL=CallsCommandHandler.js.map