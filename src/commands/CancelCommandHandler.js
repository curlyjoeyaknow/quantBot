"use strict";
/**
 * Cancel Command Handler
 * ======================
 * Handles the /cancel command for clearing user sessions.
 * Extracted from the monolithic bot.ts to improve modularity and testability.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CancelCommandHandler = void 0;
const CommandHandler_1 = require("./interfaces/CommandHandler");
const events_1 = require("../events");
const logger_1 = require("../utils/logger");
class CancelCommandHandler extends CommandHandler_1.BaseCommandHandler {
    constructor(sessionService) {
        super();
        this.sessionService = sessionService;
        this.command = 'cancel';
    }
    async execute(ctx, session) {
        const userId = ctx.from?.id;
        if (!userId) {
            await this.sendError(ctx, 'Unable to identify user.');
            return;
        }
        try {
            if (this.sessionService.hasSession(userId)) {
                const session = this.sessionService.getSession(userId);
                this.sessionService.clearSession(userId);
                // Emit session cleared event
                await events_1.eventBus.publish(events_1.EventFactory.createUserEvent('user.session.cleared', { sessionData: session }, 'CancelCommandHandler', userId));
                // Emit command executed event
                await events_1.eventBus.publish(events_1.EventFactory.createUserEvent('user.command.executed', { command: 'cancel', success: true }, 'CancelCommandHandler', userId));
                await ctx.reply('✅ **Simulation cancelled!**\n\nSession cleared. Use `/backtest` to start over.');
            }
            else {
                await ctx.reply('❌ No active session to cancel.');
            }
        }
        catch (error) {
            logger_1.logger.error('Cancel command error', error, { userId });
            // Emit command failed event
            await events_1.eventBus.publish(events_1.EventFactory.createUserEvent('user.command.failed', { command: 'cancel', success: false, error: error instanceof Error ? error.message : String(error) }, 'CancelCommandHandler', userId));
            await this.sendError(ctx, 'Failed to cancel session. Please try again.');
        }
    }
}
exports.CancelCommandHandler = CancelCommandHandler;
//# sourceMappingURL=CancelCommandHandler.js.map