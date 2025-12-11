"use strict";
/**
 * Repeat Command Handler
 * ======================
 * Handles the /repeat command for repeating previous simulations.
 * Extracted from the monolithic bot.ts to improve modularity and testability.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RepeatCommandHandler = void 0;
const CommandHandler_1 = require("./interfaces/CommandHandler");
const logger_1 = require("../utils/logger");
class RepeatCommandHandler extends CommandHandler_1.BaseCommandHandler {
    constructor(simulationService, sessionService, repeatHelper) {
        super();
        this.simulationService = simulationService;
        this.sessionService = sessionService;
        this.repeatHelper = repeatHelper;
        this.command = 'repeat';
    }
    async execute(ctx, session) {
        const userId = ctx.from?.id;
        if (!userId) {
            await this.sendError(ctx, 'Unable to identify user.');
            return;
        }
        try {
            const recentRuns = await this.simulationService.getUserSimulationRuns(userId, 5);
            if (recentRuns.length === 0) {
                await ctx.reply('❌ No previous simulations found. Use `/backtest` first.');
                return;
            }
            if (recentRuns.length > 1) {
                // Show last N runs, let user pick
                let message = '🔄 **Recent Simulations:**\n\n';
                recentRuns.forEach((run, idx) => {
                    const chainEmoji = run.chain === 'ethereum' ? '⟠' : run.chain === 'bsc' ? '🟡' : run.chain === 'base' ? '🔵' : '◎';
                    const timeAgo = run.createdAt ? run.createdAt.toRelative() : run.startTime.toRelative();
                    message += `${idx + 1}. ${chainEmoji} **${run.tokenName || 'Unknown'}** (${run.tokenSymbol || 'N/A'})\n`;
                    message += `   📅 ${run.startTime.toFormat('MM-dd HH:mm')} - ${run.endTime.toFormat('MM-dd HH:mm')}\n`;
                    message += `   💰 PNL: ${run.finalPnl.toFixed(2)}x | ${timeAgo}\n\n`;
                });
                message += '**Reply with the number** (1-5) to repeat, or **"last"** for the most recent.';
                await ctx.reply(message, { parse_mode: 'Markdown' });
                // Set session to wait for user selection
                const newSession = {
                    step: 'waiting_for_run_selection',
                    type: 'repeat',
                    data: {
                        waitingForRunSelection: true,
                        recentRuns: recentRuns
                    }
                };
                this.sessionService.setSession(userId, newSession);
                return;
            }
            // Only one run: repeat directly
            await this.repeatHelper.repeatSimulation(ctx, recentRuns[0]);
        }
        catch (err) {
            logger_1.logger.error('Repeat command error', err, { userId });
            await this.sendError(ctx, 'An error occurred while fetching previous simulations.');
        }
    }
}
exports.RepeatCommandHandler = RepeatCommandHandler;
//# sourceMappingURL=RepeatCommandHandler.js.map