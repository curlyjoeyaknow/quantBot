"use strict";
/**
 * Command Handler Interface
 * ========================
 * Defines the contract for all command handlers in the QuantBot system.
 * This interface enables consistent command processing and makes the system
 * more testable and maintainable.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseCommandHandler = void 0;
/**
 * Base class for command handlers with common functionality
 */
class BaseCommandHandler {
    /**
     * Get or create a session for the user
     */
    getOrCreateSession(userId, sessions) {
        if (!sessions[userId]) {
            sessions[userId] = {};
        }
        return sessions[userId];
    }
    /**
     * Clear a user's session
     */
    clearSession(userId, sessions) {
        delete sessions[userId];
    }
    /**
     * Send a formatted error message
     */
    async sendError(ctx, message) {
        await ctx.reply(`❌ **Error**\n\n${message}`, { parse_mode: 'Markdown' });
    }
    /**
     * Send a formatted success message
     */
    async sendSuccess(ctx, message) {
        await ctx.reply(`✅ **Success**\n\n${message}`, { parse_mode: 'Markdown' });
    }
    /**
     * Send a formatted info message
     */
    async sendInfo(ctx, message) {
        await ctx.reply(`ℹ️ **Info**\n\n${message}`, { parse_mode: 'Markdown' });
    }
}
exports.BaseCommandHandler = BaseCommandHandler;
//# sourceMappingURL=CommandHandler.js.map