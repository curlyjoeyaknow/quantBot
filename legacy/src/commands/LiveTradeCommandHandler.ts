/**
 * Live Trade Command Handler
 * ==========================
 * Handles commands for starting/stopping live trade alert monitoring
 */

import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { logger } from '../utils/logger';
import { LiveTradeAlertService } from '../monitoring/live-trade-alert-service';

// Singleton service instance
let liveTradeService: LiveTradeAlertService | null = null;

export class LiveTradeCommandHandler extends BaseCommandHandler {
  readonly command = 'livetrade';

  async execute(ctx: Context, session?: Session): Promise<void> {
    try {
      const args = ctx.message && 'text' in ctx.message 
        ? ctx.message.text.split(' ').slice(1) 
        : [];
      const subcommand = args[0]?.toLowerCase();

      if (subcommand === 'start') {
        await this.handleStart(ctx);
      } else if (subcommand === 'stop') {
        await this.handleStop(ctx);
      } else if (subcommand === 'status') {
        await this.handleStatus(ctx);
      } else {
        await ctx.reply(
          '📊 **Live Trade Alert Commands:**\n\n' +
          '`/livetrade start` - Start monitoring tokens from caller_alerts\n' +
          '`/livetrade stop` - Stop monitoring\n' +
          '`/livetrade status` - Show current status',
          { parse_mode: 'Markdown' }
        );
      }
    } catch (error) {
      logger.error('Live trade command error', error as Error, { userId: ctx.from?.id });
      await this.sendError(ctx, '❌ Error processing live trade command. Please try again.');
    }
  }

  private async handleStart(ctx: Context): Promise<void> {
    if (liveTradeService && liveTradeService.getStatus().isRunning) {
      await ctx.reply('⚠️ Live trade alert service is already running.');
      return;
    }

    await ctx.reply('🚀 Starting live trade alert service...');

    try {
      if (!liveTradeService) {
        liveTradeService = new LiveTradeAlertService();

        // Handle entry alerts
        liveTradeService.on('entryAlert', async (alert) => {
          logger.info('Entry alert triggered', {
            tokenSymbol: alert.tokenSymbol,
            entryType: alert.entryType,
          });
        });
      }

      await liveTradeService.start();
      const status = liveTradeService.getStatus();

      await ctx.reply(
        `✅ **Live Trade Alert Service Started**\n\n` +
        `📊 Monitoring: ${status.monitoredTokens} tokens\n` +
        `🔌 WebSocket: ${status.websocketConnected ? 'Connected' : 'Disconnected'}\n` +
        `📢 Alert Groups: ${status.alertGroups}`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      logger.error('Failed to start live trade service', error as Error);
      await ctx.reply('❌ Failed to start live trade alert service. Check logs for details.');
    }
  }

  private async handleStop(ctx: Context): Promise<void> {
    if (!liveTradeService || !liveTradeService.getStatus().isRunning) {
      await ctx.reply('⚠️ Live trade alert service is not running.');
      return;
    }

    await ctx.reply('🛑 Stopping live trade alert service...');

    try {
      await liveTradeService.stop();
      await ctx.reply('✅ Live trade alert service stopped.');
    } catch (error) {
      logger.error('Failed to stop live trade service', error as Error);
      await ctx.reply('❌ Failed to stop live trade alert service. Check logs for details.');
    }
  }

  private async handleStatus(ctx: Context): Promise<void> {
    if (!liveTradeService) {
      await ctx.reply('⚠️ Live trade alert service has not been initialized.');
      return;
    }

    const status = liveTradeService.getStatus();

    await ctx.reply(
      `📊 **Live Trade Alert Status**\n\n` +
      `🟢 Running: ${status.isRunning ? 'Yes' : 'No'}\n` +
      `📊 Monitored Tokens: ${status.monitoredTokens}\n` +
      `🔌 WebSocket: ${status.websocketConnected ? '✅ Connected' : '❌ Disconnected'}\n` +
      `📢 Alert Groups: ${status.alertGroups}`,
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * Get the service instance (for external use)
   */
  public static getService(): LiveTradeAlertService | null {
    return liveTradeService;
  }
}

