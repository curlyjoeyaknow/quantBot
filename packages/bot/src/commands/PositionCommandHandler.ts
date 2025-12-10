/**
 * Position Command Handler
 * 
 * Handles position management commands: /positions, /positions close
 */

import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { PositionManager } from '../trading-stubs';
import { logger } from '@quantbot/utils';
import { extractCommandArgs } from '../utils/command-helpers';

export class PositionCommandHandler extends BaseCommandHandler {
  readonly command = 'positions';

  protected defaultOptions = {
    timeout: 10_000,
    requirePrivateChat: true,
    rateLimit: true,
    showTyping: true,
  };

  constructor(private positionManager: PositionManager) {
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
      if (subcommand === 'close' && args[1]) {
        await this.handleClose(ctx, userId, args[1]);
      } else {
        await this.handleList(ctx, userId);
      }
    } catch (error) {
      logger.error('Position command failed', error as Error, { userId, subcommand });
      await this.sendError(ctx, 'An error occurred processing your request.');
    }
  }

  private async handleList(ctx: Context, userId: number): Promise<void> {
    try {
      const positions = await this.positionManager.getOpenPositions(userId);

      if (positions.length === 0) {
        await this.sendInfo(ctx, 'No open positions.');
        return;
      }

      let message = `**Open Positions**\n\n`;
      for (const position of positions) {
        const pnl = this.positionManager.calculatePnL(position, position.entryPrice); // Use entry price as current for display
        const pnlPercent = ((position.entryPrice - position.entryPrice) / position.entryPrice) * 100; // Will be updated with real price
        message += `**Position #${position.id}**\n`;
        message += `Token: \`${position.tokenMint.substring(0, 8)}...\`\n`;
        message += `Entry: ${position.entryPrice.toFixed(8)} SOL\n`;
        message += `Size: ${position.remainingSize.toFixed(4)} SOL\n`;
        message += `Status: ${position.status}\n`;
        if (position.stopLossPrice) {
          message += `Stop Loss: ${position.stopLossPrice.toFixed(8)} SOL\n`;
        }
        message += `\n`;
      }

      await this.sendInfo(ctx, message);
    } catch (error) {
      logger.error('Failed to list positions', error as Error, { userId });
      await this.sendError(ctx, 'Failed to retrieve positions.');
    }
  }

  private async handleClose(ctx: Context, userId: number, positionIdStr: string): Promise<void> {
    try {
      const positionId = parseInt(positionIdStr);
      const position = await this.positionManager.getPosition(positionId);

      if (!position || position.userId !== userId) {
        await this.sendError(ctx, 'Position not found.');
        return;
      }

      if (position.status !== 'open') {
        await this.sendError(ctx, 'Position is already closed.');
        return;
      }

      // Note: Actual closing requires transaction execution
      // For now, we'll just show a message
      await this.sendInfo(
        ctx,
        `To close position #${positionId}, please use the trading interface.\n\n` +
          `This feature will be implemented with transaction execution.`
      );
    } catch (error) {
      logger.error('Failed to close position', error as Error, { userId, positionIdStr });
      await this.sendError(ctx, 'Failed to close position.');
    }
  }
}

