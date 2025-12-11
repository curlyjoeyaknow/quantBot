"use strict";
/**
 * Ichimoku Command Handler
 * ========================
 * Handles the /ichimoku command for initiating Ichimoku Cloud analysis
 * and monitoring workflows.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IchimokuCommandHandler = void 0;
const CommandHandler_1 = require("./interfaces/CommandHandler");
const logger_1 = require("../utils/logger");
class IchimokuCommandHandler extends CommandHandler_1.BaseCommandHandler {
    constructor(sessionService) {
        super();
        this.sessionService = sessionService;
        this.command = 'ichimoku';
    }
    async execute(ctx, session) {
        const userId = ctx.from?.id;
        if (!userId) {
            await this.sendError(ctx, 'Unable to identify user.');
            return;
        }
        logger_1.logger.debug('/ichimoku command triggered', { userId });
        try {
            // Clear any existing session to prevent conflicts
            this.sessionService.clearSession(userId);
            // Initialize Ichimoku session
            const newSession = {
                step: 'waiting_for_mint',
                type: 'ichimoku',
                data: {}
            };
            this.sessionService.setSession(userId, newSession);
            await ctx.reply('📈 **Ichimoku Cloud Analysis**\n\n' +
                'Paste the token address (Solana or EVM) to start Ichimoku monitoring.\n\n' +
                'The bot will:\n' +
                '• Fetch 52 historical 5-minute candles from Birdeye\n' +
                '• Calculate Ichimoku Cloud components\n' +
                '• Start real-time price monitoring\n' +
                '• Send alerts for Ichimoku signals\n\n' +
                'Type `/cancel` to abort.', { parse_mode: 'Markdown' });
        }
        catch (error) {
            logger_1.logger.error('Ichimoku command error', error, { userId });
            await this.sendError(ctx, 'Failed to initialize Ichimoku analysis. Please try again.');
        }
    }
}
exports.IchimokuCommandHandler = IchimokuCommandHandler;
//# sourceMappingURL=IchimokuCommandHandler.js.map