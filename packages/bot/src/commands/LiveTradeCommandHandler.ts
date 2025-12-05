/**
 * Live Trade Command Handler
 * 
 * Handles live trading commands: /livetrade enable, disable, status, config
 */

import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { TradingConfigService } from '@quantbot/trading';
import { logger } from '@quantbot/utils';
import { extractCommandArgs } from '../utils/command-helpers';

export class LiveTradeCommandHandler extends BaseCommandHandler {
  readonly command = 'livetrade';

  protected defaultOptions = {
    timeout: 10_000,
    requirePrivateChat: true,
    rateLimit: true,
    showTyping: true,
  };

  constructor(private tradingConfigService: TradingConfigService) {
    super();
  }

  async execute(ctx: Context, session?: Session): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await this.sendError(ctx, 'Unable to identify user.');
      return;
    }

    const message = 'text' in (ctx.message ?? {}) ? (ctx.message as { text: string }).text : '';
    const args = extractCommandArgs(message, this.command);
    const subcommand = args[0]?.toLowerCase();

    try {
      switch (subcommand) {
        case 'enable':
          await this.handleEnable(ctx, userId);
          break;
        case 'disable':
          await this.handleDisable(ctx, userId);
          break;
        case 'status':
          await this.handleStatus(ctx, userId);
          break;
        case 'config':
          await this.handleConfig(ctx, userId, args.slice(1));
          break;
        default:
          await this.sendInfo(
            ctx,
            `Usage: /livetrade <enable|disable|status|config>\n\n` +
              `• enable - Enable live trading\n` +
              `• disable - Disable live trading\n` +
              `• status - Show trading status and configuration\n` +
              `• config - Configure trading parameters`
          );
      }
    } catch (error) {
      logger.error('Live trade command failed', error as Error, { userId, subcommand });
      await this.sendError(ctx, 'An error occurred processing your request.');
    }
  }

  private async handleEnable(ctx: Context, userId: number): Promise<void> {
    await this.tradingConfigService.enableTrading(userId);
    await this.sendSuccess(ctx, '✅ Live trading enabled for your account.');
  }

  private async handleDisable(ctx: Context, userId: number): Promise<void> {
    await this.tradingConfigService.disableTrading(userId);
    await this.sendSuccess(ctx, '❌ Live trading disabled for your account.');
  }

  private async handleStatus(ctx: Context, userId: number): Promise<void> {
    const config = await this.tradingConfigService.getConfig(userId);

    if (!config) {
      await this.sendInfo(ctx, 'Trading not configured. Use /livetrade config to set up.');
      return;
    }

    const status = config.enabled ? '✅ Enabled' : '❌ Disabled';
    const dryRun = config.dryRun ? '🟡 Dry Run' : '🔴 Live';

    const message = `
**Live Trading Status**

Status: ${status}
Mode: ${dryRun}

**Risk Limits:**
• Max Position: ${config.maxPositionSize} SOL
• Max Total Exposure: ${config.maxTotalExposure} SOL
• Daily Loss Limit: ${config.dailyLossLimit} SOL
• Slippage Tolerance: ${(config.slippageTolerance * 100).toFixed(2)}%

**Alert Rules:**
• CA Drop Alerts: ${config.alertRules.caDropAlerts ? '✅' : '❌'}
• Ichimoku Signals: ${config.alertRules.ichimokuSignals ? '✅' : '❌'}
• Live Trade Entry: ${config.alertRules.liveTradeEntry ? '✅' : '❌'}
    `.trim();

    await this.sendInfo(ctx, message);
  }

  private async handleConfig(ctx: Context, userId: number, args: string[]): Promise<void> {
    if (args.length === 0) {
      await this.sendInfo(
        ctx,
        `Usage: /livetrade config <parameter> <value>\n\n` +
          `Parameters:\n` +
          `• max_position <SOL> - Maximum position size\n` +
          `• max_exposure <SOL> - Maximum total exposure\n` +
          `• slippage <percent> - Slippage tolerance (e.g., 1 for 1%)\n` +
          `• daily_loss <SOL> - Daily loss limit\n` +
          `• dry_run <true|false> - Enable/disable dry-run mode`
      );
      return;
    }

    const param = args[0].toLowerCase();
    const value = args[1];

    try {
      const updates: any = {};

      switch (param) {
        case 'max_position':
          updates.maxPositionSize = parseFloat(value);
          break;
        case 'max_exposure':
          updates.maxTotalExposure = parseFloat(value);
          break;
        case 'slippage':
          updates.slippageTolerance = parseFloat(value) / 100;
          break;
        case 'daily_loss':
          updates.dailyLossLimit = parseFloat(value);
          break;
        case 'dry_run':
          updates.dryRun = value.toLowerCase() === 'true';
          break;
        default:
          await this.sendError(ctx, `Unknown parameter: ${param}`);
          return;
      }

      await this.tradingConfigService.upsertConfig({ userId, ...updates });
      await this.sendSuccess(ctx, `✅ Configuration updated: ${param} = ${value}`);
    } catch (error) {
      logger.error('Config update failed', error as Error, { userId, param, value });
      await this.sendError(ctx, 'Failed to update configuration. Please check your values.');
    }
  }
}
