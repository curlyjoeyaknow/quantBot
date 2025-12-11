/**
 * Repeat Command Handler
 * ======================
 * Handles the /repeat command for repeating previous simulations.
 * Extracted from the monolithic bot.ts to improve modularity and testability.
 */

import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { SimulationService, SessionService } from '@quantbot/services';
import { RepeatSimulationHelper } from '../utils/RepeatSimulationHelper';
import { logger } from '@quantbot/utils';
import { COMMAND_TIMEOUTS } from '../utils/command-helpers';

export class RepeatCommandHandler extends BaseCommandHandler {
  readonly command = 'repeat';
  
  protected defaultOptions = {
    timeout: COMMAND_TIMEOUTS.STANDARD,
    requirePrivateChat: true,
    rateLimit: true,
    showTyping: true,
  };
  
  constructor(
    private simulationService: SimulationService,
    private sessionService: SessionService,
    private repeatHelper: RepeatSimulationHelper
  ) {
    super();
  }
  
  async execute(ctx: Context, session?: Session): Promise<void> {
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
        const newSession: Session = {
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
    } catch (err) {
      logger.error('Repeat command error', err as Error, { userId });
      await this.sendError(ctx, 'An error occurred while fetching previous simulations.');
    }
  }
}
