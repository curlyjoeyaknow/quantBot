/**
 * Backtest Call Command Handler
 * =============================
 * Handles the /backtest_call command for backtesting historical CA calls
 * with strategies.
 */

import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { SessionService, SimulationService } from '@quantbot/services';
import { getCACallByMint, saveSimulationRun } from '@quantbot/utils';
import { fetchHybridCandles } from '@quantbot/data';
import { simulateStrategy } from '@quantbot/simulation';
import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import { extractCommandArgs, isValidTokenAddress, sanitizeInput, COMMAND_TIMEOUTS } from '../utils/command-helpers';
import { BotCACall } from '../types/session';

export class BacktestCallCommandHandler extends BaseCommandHandler {
  readonly command = 'backtest_call';
  
  protected defaultOptions = {
    timeout: COMMAND_TIMEOUTS.LONG, // 2 minutes for backtest operations
    requirePrivateChat: true,
    rateLimit: true,
    showTyping: true,
  };
  
  constructor(
    private sessionService: SessionService,
    private simulationService: SimulationService
  ) {
    super();
  }
  
  async execute(ctx: Context, session?: Session): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await this.sendError(ctx, 'Unable to identify user.');
      return;
    }
    
    // Parse and validate command arguments
    const message = 'text' in (ctx.message ?? {}) ? (ctx.message as { text: string }).text : '';
    const args = extractCommandArgs(message, this.command);
    
    if (args.length === 0) {
      await ctx.reply(
        '❌ **Usage:** `/backtest_call <mint_address>`\n\n' +
        'Example: `/backtest_call 0xf73f123Ff5fe61fd94fE0496b35f7bF4eBa84444`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Sanitize and validate token address
    const mint = sanitizeInput(args[0], 100);
    
    if (!isValidTokenAddress(mint)) {
      await this.sendError(
        ctx,
        'Invalid token address format. Please provide a valid Solana or EVM address.'
      );
      return;
    }
    
    try {
      const progress = this.createProgressMessage(ctx);
      await progress.send('🔍 **Searching for historical call...**');
      
      // Get the CA call from database
      const call = (await getCACallByMint(mint)) as BotCACall | null;
      
      await progress.delete();
      
      if (!call) {
        await ctx.reply(
          `❌ **CA Call Not Found**\n\n` +
          `No historical call found for mint: \`${mint.replace(/`/g, '\\`')}\`\n\n` +
          `Use \`/history\` to see available calls.`,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      const callTimestamp =
        call.call_timestamp ??
        (call.alert_timestamp ? Math.floor(new Date(call.alert_timestamp).getTime() / 1000) : undefined);
      if (!callTimestamp) {
        await this.sendError(ctx, 'Call is missing timestamp information.');
        return;
      }
      const tokenName = call.token_name || 'Unknown';
      const tokenSymbol = call.token_symbol || 'N/A';

      // Start backtest workflow for this historical call
      const newSession: Session = {
        step: 'backtesting',
        type: 'backtest_call',
        data: {
          mint: call.mint,
          chain: call.chain,
          metadata: {
            name: tokenName,
            symbol: tokenSymbol
          },
          datetime: DateTime.fromSeconds(callTimestamp),
          strategy: [{ percent: 0.5, target: 2 }, { percent: 0.3, target: 5 }, { percent: 0.2, target: 10 }],
          stopLossConfig: { initial: -0.3, trailing: 0.5 },
          entryConfig: { initialEntry: 'none', trailingEntry: 'none', maxWaitTime: 60 },
          reEntryConfig: { trailingReEntry: 'none', maxReEntries: 0, sizePercent: 0.5 }
        }
      };
      
      this.sessionService.setSession(userId, newSession);

      await progress.send('📊 **Fetching historical data...**');
      
      await ctx.reply(
        `🎯 **Backtesting Historical Call**\n\n` +
        `🪙 **${tokenName}** (${tokenSymbol})\n` +
        `🔗 **Chain**: ${call.chain.toUpperCase()}\n` +
        `📅 **Call Date**: ${new Date(callTimestamp * 1000).toLocaleString()}\n` +
        `💰 **Call Price**: $${call.call_price?.toFixed(8) || 'N/A'}\n` +
        `👤 **Caller**: ${call.caller || 'Unknown'}\n\n` +
        `Running simulation with default strategy...`,
        { parse_mode: 'Markdown' }
      );

      // Run the simulation immediately
      try {
        await progress.update('📊 **Fetching candle data...**');
        
        const alertTime = DateTime.fromSeconds(callTimestamp);
        // Pass alertTime for 1m candles around alert time
        const candles = await fetchHybridCandles(
          call.mint,
          alertTime,
          DateTime.utc(),
          call.chain,
          alertTime
        );

        if (!candles.length) {
          await progress.delete();
          await ctx.reply('❌ No candle data available for this historical call.');
          this.sessionService.clearSession(userId);
          return;
        }

        if (!newSession.data) {
          await progress.delete();
          await ctx.reply('❌ Session data is missing.');
          this.sessionService.clearSession(userId);
          return;
        }
        
        await progress.update('⚙️ **Running simulation...**');
        
        const result = simulateStrategy(
          candles, 
          newSession.data.strategy!, 
          newSession.data.stopLossConfig!, 
          newSession.data.entryConfig!, 
          newSession.data.reEntryConfig!
        );
        
        // Format and send results
        const lowestPrice = result.entryOptimization.lowestPrice;
        const lowestPercent = result.entryOptimization.lowestPricePercent;
        const lowestTimeStr = result.entryOptimization.lowestPriceTimeFromEntry < 60 
          ? `${result.entryOptimization.lowestPriceTimeFromEntry.toFixed(0)}m`
          : `${(result.entryOptimization.lowestPriceTimeFromEntry / 60).toFixed(1)}h`;

        const chainEmoji = call.chain === 'solana' ? '🟣' : 
                          call.chain === 'ethereum' ? '🔵' : 
                          call.chain === 'bsc' ? '🟡' : '⚪';
        
        let resultMessage = `🎯 **Historical Call Backtest Results**\n\n` +
          `${chainEmoji} Chain: ${call.chain.toUpperCase()}\n` +
          `🪙 Token: ${call.token_name || 'Unknown'} (${call.token_symbol || 'N/A'})\n` +
          `📅 Call Date: ${new Date(callTimestamp * 1000).toLocaleString()}\n` +
          `👤 Caller: ${call.caller || 'Unknown'}\n` +
          `📈 Candles: ${result.totalCandles}\n` +
          `💰 Simulated PNL: **${result.finalPnl.toFixed(2)}x**\n\n` +
          `🔍 **Entry Optimization:**\n` +
          `• Lowest Price: $${lowestPrice.toFixed(8)} (${lowestPercent.toFixed(1)}%)\n` +
          `• Time to Lowest: ${lowestTimeStr}\n\n` +
          `📋 **Key Events:**\n`;

        // Show key events
        const keyEvents = result.events.filter(e => 
          ['entry', 'target_hit', 'stop_loss', 'final_exit'].includes(e.type)
        );
        for (const event of keyEvents.slice(0, 5)) {
          const eventEmoji = event.type === 'entry' ? '🚀' :
            event.type === 'target_hit' ? '🎯' :
            event.type === 'stop_loss' ? '🛑' : '🏁';
          const timestamp = DateTime.fromSeconds(event.timestamp).toFormat('MM-dd HH:mm');
          resultMessage += `${eventEmoji} ${timestamp}: ${event.description}\n`;
        }

        await progress.delete();
        await ctx.reply(resultMessage, { parse_mode: 'Markdown' });

        // Save this backtest run
        if (newSession.data) {
          await saveSimulationRun({
            userId: userId,
            mint: call.mint,
            chain: call.chain,
            tokenName: call.token_name,
            tokenSymbol: call.token_symbol,
            startTime: DateTime.fromSeconds(callTimestamp),
            endTime: DateTime.utc(),
            strategy: newSession.data.strategy!,
            stopLossConfig: newSession.data.stopLossConfig!,
            finalPnl: result.finalPnl,
            totalCandles: result.totalCandles,
            events: result.events
          });
        }

        // Clear the session
        this.sessionService.clearSession(userId);

      } catch (simError) {
        logger.error('Simulation error', simError as Error, { userId, mint });
        await this.sendError(ctx, '❌ Simulation failed. Please try again.');
        this.sessionService.clearSession(userId);
      }
      
    } catch (error) {
      logger.error('Backtest call command error', error as Error, { userId, mint });
      await this.sendError(ctx, '❌ Failed to backtest historical call. Please try again.');
    }
  }
}
