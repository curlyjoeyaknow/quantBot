"use strict";
/**
 * Backtest Command Handler
 * =======================
 * Handles the /backtest command for starting new simulation workflows.
 * Extracted from the monolithic bot.ts to improve modularity and testability.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BacktestCommandHandler = void 0;
const telegraf_1 = require("telegraf");
const CommandHandler_1 = require("./interfaces/CommandHandler");
const events_1 = require("../events");
const logger_1 = require("../utils/logger");
class BacktestCommandHandler extends CommandHandler_1.BaseCommandHandler {
    constructor(sessionService) {
        super();
        this.sessionService = sessionService;
        this.command = 'backtest';
    }
    async execute(ctx, session) {
        const userId = ctx.from?.id;
        if (!userId) {
            await this.sendError(ctx, 'Unable to identify user.');
            return;
        }
        try {
            // Initialize session for backtest workflow
            const newSession = {
                step: 'selecting_source',
                type: 'backtest',
                data: {}
            };
            // Store session using SessionService
            this.sessionService.setSession(userId, newSession);
            // Emit user session started event
            await events_1.eventBus.publish(events_1.EventFactory.createUserEvent('user.session.started', { sessionData: newSession }, 'BacktestCommandHandler', userId));
            // Emit command executed event
            await events_1.eventBus.publish(events_1.EventFactory.createUserEvent('user.command.executed', { command: 'backtest', success: true }, 'BacktestCommandHandler', userId));
            // Show menu with 4 options
            await ctx.reply('🤖 **QuantBot - Backtest Mode**\n\n' +
                '**Select how you want to start your backtest:**', telegraf_1.Markup.inlineKeyboard([
                [telegraf_1.Markup.button.callback('📊 Recent Backtests', 'backtest_source:recent_backtests')],
                [telegraf_1.Markup.button.callback('📞 Recent Calls', 'backtest_source:recent_calls')],
                [telegraf_1.Markup.button.callback('👤 Calls by Caller', 'backtest_source:by_caller')],
                [telegraf_1.Markup.button.callback('✍️ Manual Mint Entry', 'backtest_source:manual')]
            ]));
        }
        catch (error) {
            logger_1.logger.error('Backtest command error', error, { userId });
            // Emit command failed event
            await events_1.eventBus.publish(events_1.EventFactory.createUserEvent('user.command.failed', { command: 'backtest', success: false, error: error instanceof Error ? error.message : String(error) }, 'BacktestCommandHandler', userId));
            await this.sendError(ctx, 'Failed to initialize backtest session. Please try again.');
        }
    }
}
exports.BacktestCommandHandler = BacktestCommandHandler;
//# sourceMappingURL=BacktestCommandHandler.js.map