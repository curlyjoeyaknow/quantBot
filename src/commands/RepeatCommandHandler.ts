/**
 * Repeat Command Handler
 * ======================
 * Handles the /repeat command for repeating previous simulations.
 * Extracted from the monolithic bot.ts to improve modularity and testability.
 */

import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { SimulationService } from '../services/SimulationService';
import { SessionService } from '../services/SessionService';
import { eventBus, EventFactory } from '../events';

export class RepeatCommandHandler extends BaseCommandHandler {
  readonly command = 'repeat';
  
  constructor(
    private simulationService: SimulationService,
    private sessionService: SessionService
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
          const timeAgo = run.createdAt.toRelative();
          message += `${idx + 1}. ${chainEmoji} **${run.tokenName || 'Unknown'}** (${run.tokenSymbol || 'N/A'})\n`;
          message += `   📅 ${run.startTime.toFormat('MM-dd HH:mm')} - ${run.endTime.toFormat('MM-dd HH:mm')}\n`;
          message += `   💰 PNL: ${run.finalPnl.toFixed(2)}x | ${timeAgo}\n\n`;
        });
        message += '**Reply with the number** (1-5) to repeat, or **"last"** for the most recent.';
        
        await ctx.reply(message, { parse_mode: 'Markdown' });
        
        // Set session to wait for user selection
        this.sessionService.updateSession(userId, {
          waitingForRunSelection: true,
          recentRuns: recentRuns
        });
        return;
      }

      // Only one run: repeat directly
      await this.repeatSimulation(ctx, recentRuns[0]);
    } catch (err) {
      console.error('Repeat command error:', err);
      await this.sendError(ctx, 'An error occurred while fetching previous simulations.');
    }
  }
  
  private async repeatSimulation(ctx: any, run: any): Promise<void> {
    const userId = ctx.from.id;
    
    const session: Session = {
      mint: run.mint,
      chain: run.chain,
      datetime: run.startTime,
      metadata: { name: run.tokenName, symbol: run.tokenSymbol },
      strategy: undefined,
      stopLossConfig: undefined,
      lastSimulation: {
        mint: run.mint,
        chain: run.chain,
        datetime: run.startTime,
        metadata: { name: run.tokenName, symbol: run.tokenSymbol },
        candles: [],
      },
    };
    
    this.sessionService.setSession(userId, session);

    const chainEmoji = run.chain === 'ethereum' ? '⟠' : run.chain === 'bsc' ? '🟡' : run.chain === 'base' ? '🔵' : '◎';
    await ctx.reply(
      `🔄 **Repeating Simulation**\n\n` +
        `${chainEmoji} Chain: ${run.chain.toUpperCase()}\n` +
        `🪙 Token: ${run.tokenName} (${run.tokenSymbol})\n` +
        `📅 Period: ${run.startTime.toFormat('yyyy-MM-dd HH:mm')} - ${run.endTime.toFormat('yyyy-MM-dd HH:mm')}\n\n` +
        `**Take Profit Strategy:**\n• \`yes\` - Default: 50%@2x, 30%@5x, 20%@10x\n• \`50@2x,30@5x,20@10x\` - Custom\n• \`[{"percent":0.5,"target":2}]\` - JSON`
    );
  }
}
