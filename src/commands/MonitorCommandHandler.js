"use strict";
/**
 * Monitor Command Handler
 * =======================
 * Handles the /monitor command for real-time Ichimoku Tenkan/Kijun cross monitoring
 * of specific token mints.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MonitorCommandHandler = void 0;
const CommandHandler_1 = require("./interfaces/CommandHandler");
const tenkan_kijun_alert_service_1 = require("../monitoring/tenkan-kijun-alert-service");
const logger_1 = require("../utils/logger");
// Singleton instance of the alert service
let alertService = null;
const activeMonitors = new Map(); // userId -> Set of mint addresses
function getAlertService() {
    if (!alertService) {
        alertService = new tenkan_kijun_alert_service_1.TenkanKijunAlertService(process.env.SHYFT_API_KEY, process.env.SHYFT_WS_URL, process.env.SHYFT_X_TOKEN, process.env.SHYFT_GRPC_URL);
        // Start the service
        alertService.start().catch((error) => {
            logger_1.logger.error('Failed to start alert service', error);
        });
        // Set up alert handler
        alertService.on('alert', (alert) => {
            // Alerts are handled per-user in the monitor command
            logger_1.logger.info('Alert received', { type: alert.type, tokenSymbol: alert.tokenSymbol, tokenAddress: alert.tokenAddress });
        });
    }
    return alertService;
}
class MonitorCommandHandler extends CommandHandler_1.BaseCommandHandler {
    constructor() {
        super(...arguments);
        this.command = 'monitor';
    }
    async execute(ctx, session) {
        const userId = ctx.from?.id;
        if (!userId) {
            await this.sendError(ctx, 'Unable to identify user.');
            return;
        }
        const messageText = ctx.message?.text || '';
        const parts = messageText.split(' ').filter((p) => p.length > 0);
        // If no mint provided, show usage
        if (parts.length < 2) {
            await ctx.reply('📊 **Ichimoku Real-Time Monitor**\n\n' +
                '**Usage:** `/monitor <mint_address>`\n\n' +
                '**Example:**\n' +
                '`/monitor So11111111111111111111111111111111111111112`\n\n' +
                '**Features:**\n' +
                '• Monitors token price in real-time via Yellowstone gRPC\n' +
                '• Builds 5-minute candles from live price stream\n' +
                '• Calculates Ichimoku indicators (Tenkan, Kijun)\n' +
                '• Sends alerts immediately when Tenkan/Kijun crosses occur\n' +
                '• Real-time signal detection (no delays)\n\n' +
                '**Commands:**\n' +
                '• `/monitor <mint>` - Start monitoring a token\n' +
                '• `/monitor list` - List your active monitors\n' +
                '• `/monitor status` - Show detailed status of all monitors\n' +
                '• `/monitor stop <mint>` - Stop monitoring a token', { parse_mode: 'Markdown' });
            return;
        }
        const action = parts[1].toLowerCase();
        // Show status of all monitors
        if (action === 'status') {
            const service = getAlertService();
            const status = service.getMonitorStatus();
            if (status.length === 0) {
                await ctx.reply('📋 **No active monitors**\n\nYou are not monitoring any tokens.');
                return;
            }
            let statusMessage = `📊 **Monitor Status** (${status.length} active)\n\n`;
            for (const s of status) {
                statusMessage += `**${s.tokenSymbol}** (\`${s.tokenAddress.substring(0, 8)}...\`)\n`;
                statusMessage += `• Candles: ${s.candles}/52 ${s.hasEnoughCandles ? '✅' : '⏳'}\n`;
                statusMessage += `• Last Price: ${s.lastPrice ? `$${s.lastPrice.toFixed(8)}` : 'N/A'}\n`;
                statusMessage += `• Last Update: ${s.lastUpdateTime ? new Date(s.lastUpdateTime).toLocaleTimeString() : 'Never'}\n`;
                statusMessage += `• Indicators: ${s.indicatorsCalculated ? '✅' : '⏳'}\n`;
                if (s.tenkan && s.kijun) {
                    statusMessage += `• Tenkan: $${s.tenkan.toFixed(8)}\n`;
                    statusMessage += `• Kijun: $${s.kijun.toFixed(8)}\n`;
                }
                statusMessage += '\n';
            }
            await ctx.reply(statusMessage, { parse_mode: 'Markdown' });
            return;
        }
        // List active monitors
        if (action === 'list') {
            const userMonitors = activeMonitors.get(userId) || new Set();
            if (userMonitors.size === 0) {
                await ctx.reply('📋 **No active monitors**\n\nYou are not monitoring any tokens.');
                return;
            }
            const monitorList = Array.from(userMonitors).map((mint, idx) => `${idx + 1}. \`${mint}\``).join('\n');
            await ctx.reply(`📋 **Active Monitors** (${userMonitors.size})\n\n${monitorList}\n\n` +
                'Use `/monitor stop <mint>` to stop monitoring.', { parse_mode: 'Markdown' });
            return;
        }
        // Stop monitoring
        if (action === 'stop') {
            if (parts.length < 3) {
                await this.sendError(ctx, 'Please provide a mint address to stop monitoring.\n\nExample: `/monitor stop So11111111111111111111111111111111111111112`');
                return;
            }
            const mint = parts[2];
            const userMonitors = activeMonitors.get(userId) || new Set();
            if (!userMonitors.has(mint)) {
                await this.sendError(ctx, `You are not monitoring \`${mint}\`.`);
                return;
            }
            // Remove from user's monitor list
            userMonitors.delete(mint);
            if (userMonitors.size === 0) {
                activeMonitors.delete(userId);
            }
            // Stop monitoring in the service
            const service = getAlertService();
            service.removeMonitor(mint, 'solana').catch((error) => {
                logger_1.logger.error('Failed to remove monitor', error, { userId, mint });
            });
            await this.sendSuccess(ctx, `Stopped monitoring \`${mint}\`.`);
            return;
        }
        // Start monitoring a mint
        const mint = parts[1];
        // Validate mint format (basic check)
        if (mint.length < 32 || mint.length > 44) {
            await this.sendError(ctx, 'Invalid mint address format. Please provide a valid Solana token address.');
            return;
        }
        // Check if already monitoring
        const userMonitors = activeMonitors.get(userId) || new Set();
        if (userMonitors.has(mint)) {
            await ctx.reply(`⚠️ **Already Monitoring**\n\n` +
                `You are already monitoring \`${mint}\`.\n\n` +
                `Use \`/monitor stop ${mint}\` to stop monitoring.`, { parse_mode: 'Markdown' });
            return;
        }
        try {
            const service = getAlertService();
            // Add monitor to the service
            await service.addMonitor(mint, mint.substring(0, 8) + '...', // Symbol placeholder
            'solana', 'Manual', // Caller name
            new Date(), 0 // Price will be fetched
            );
            // Track in user's monitor list
            userMonitors.add(mint);
            activeMonitors.set(userId, userMonitors);
            // Set up user-specific alert handler
            const alertHandler = (alert) => {
                if (alert.tokenAddress === mint) {
                    const alertMessage = `
🚨 **${alert.type} SIGNAL** 🚨

📊 **Token:** ${alert.tokenSymbol}
📍 **Address:** \`${alert.tokenAddress}\`
💰 **Price:** $${alert.price.toFixed(8)}

📈 **Signal:** ${alert.signal}
📊 **Tenkan:** $${alert.tenkan.toFixed(8)}
📊 **Kijun:** $${alert.kijun.toFixed(8)}

⏰ **Time:** ${new Date(alert.timestamp).toLocaleString()}
          `.trim();
                    ctx.reply(alertMessage, { parse_mode: 'Markdown' }).catch((error) => {
                        logger_1.logger.error('Failed to send alert message', error, { userId, tokenAddress: alert.tokenAddress });
                    });
                }
            };
            service.on('alert', alertHandler);
            await this.sendSuccess(ctx, `✅ **Started Monitoring**\n\n` +
                `**Token:** \`${mint}\`\n` +
                `**Status:** Building candles from live stream...\n\n` +
                `**What happens next:**\n` +
                `• Real-time price updates via Yellowstone gRPC\n` +
                `• 5-minute candles built from live stream\n` +
                `• Ichimoku indicators calculated\n` +
                `• Entry signals checked after 6 hours\n` +
                `• Alerts sent for Tenkan/Kijun crosses\n\n` +
                `Use \`/monitor list\` to see all your monitors.\n` +
                `Use \`/monitor stop ${mint}\` to stop monitoring.`);
        }
        catch (error) {
            logger_1.logger.error('Monitor command error', error, { userId, mint });
            await this.sendError(ctx, `Failed to start monitoring: ${error.message}`);
        }
    }
}
exports.MonitorCommandHandler = MonitorCommandHandler;
//# sourceMappingURL=MonitorCommandHandler.js.map