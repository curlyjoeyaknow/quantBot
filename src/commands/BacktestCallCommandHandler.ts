/**
 * Backtest Call Command Handler
 * =============================
 * Handles the /backtest_call command for backtesting historical CA calls
 */

import { Context } from 'telegraf';
import { DateTime } from 'luxon';
import { BaseCommandHandler } from './interfaces/CommandHandler';
import { Session } from './interfaces/CommandHandler';
import { SimulationService } from '../services/SimulationService';
import { fetchHybridCandles } from '../simulation/candles';
import { simulateStrategy } from '../simulation/engine';

export class BacktestCallCommandHandler extends BaseCommandHandler {
  readonly command = 'backtest_call';

  constructor(private simulationService: SimulationService) {
    super();
  }

  async execute(ctx: Context, session?: Session): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply('❌ Unable to identify user');
      return;
    }

    const args = (ctx.message as any)?.text?.split(' ')?.slice(1) || [];
    
    if (args.length === 0) {
      await ctx.reply('❌ **Usage:** `/backtest_call <mint_address>`\n\nExample: `/backtest_call 0xf73f123Ff5fe61fd94fE0496b35f7bF4eBa84444`');
      return;
    }

    const mint = args[0];
    
    try {
      // Get the CA call from database
      const db = require('../utils/database');
      const call = await db.getCACallByMint(mint);
      
      if (!call) {
        await ctx.reply(`❌ **CA Call Not Found**\n\nNo historical call found for mint: \`${mint.replace(/`/g, '\\`')}\`\n\nUse \`/history\` to see available calls.`);
        return;
      }

      // Start backtest workflow for this historical call
      const backtestSession: Session = {
        mint: call.mint,
        chain: call.chain,
        metadata: {
          name: call.token_name,
          symbol: call.token_symbol
        },
        datetime: DateTime.fromSeconds(call.call_timestamp),
        strategy: [{ percent: 0.5, target: 2 }, { percent: 0.3, target: 5 }, { percent: 0.2, target: 10 }],
        stopLossConfig: { initial: -0.3, trailing: 0.5 },
        entryConfig: { trailingEntry: 'none', maxWaitTime: 60 },
        reEntryConfig: { trailingReEntry: 'none', maxReEntries: 0 }
      };

      await ctx.reply(`🎯 **Backtesting Historical Call**\n\n` +
        `🪙 **${call.token_name}** (${call.token_symbol})\n` +
        `🔗 **Chain**: ${call.chain.toUpperCase()}\n` +
        `📅 **Call Date**: ${new Date(call.call_timestamp * 1000).toLocaleString()}\n` +
        `💰 **Call Price**: $${call.call_price?.toFixed(8) || 'N/A'}\n` +
        `👤 **Caller**: ${call.caller || 'Unknown'}\n\n` +
        `Running simulation with default strategy...`);

      // Run the simulation immediately
      try {
        const candles = await fetchHybridCandles(
          call.mint,
          DateTime.fromSeconds(call.call_timestamp),
          DateTime.utc(),
          call.chain
        );

        if (candles.length === 0) {
          await ctx.reply('❌ **No Historical Data**\n\nNo candle data found for this token in the specified timeframe.');
          return;
        }

        const result = simulateStrategy(
          candles,
          backtestSession.strategy!,
          backtestSession.stopLossConfig!,
          backtestSession.entryConfig!,
          backtestSession.reEntryConfig!
        );

        // Save the simulation run
        const runId = await this.simulationService.saveSimulationRun({
          userId,
          mint: call.mint,
          chain: call.chain,
          metadata: backtestSession.metadata,
          datetime: backtestSession.datetime,
          candles,
          strategy: backtestSession.strategy!,
          stopLossConfig: backtestSession.stopLossConfig!,
          entryConfig: backtestSession.entryConfig!,
          reEntryConfig: backtestSession.reEntryConfig!,
          results: result
        });

        // Format and send results
        const resultsMessage = this.formatBacktestResults(result, call.token_name, call.token_symbol);
        await ctx.reply(resultsMessage);

      } catch (simulationError) {
        console.error('Simulation error:', simulationError);
        await ctx.reply('❌ **Simulation Failed**\n\nAn error occurred during the backtest simulation.');
      }
      
    } catch (error) {
      console.error('Backtest call command error:', error);
      await ctx.reply('❌ **Backtest Failed**\n\nAn error occurred while processing the historical call.');
    }
  }

  private formatBacktestResults(result: any, tokenName: string, tokenSymbol: string): string {
    const totalReturn = ((result.finalPnl || 0) * 100).toFixed(2);
    const winRate = result.events?.filter((e: any) => e.type === 'target_hit').length > 0 ? '100%' : '0%';
    
    return `📊 **Backtest Results for ${tokenName} (${tokenSymbol})**\n\n` +
      `💰 **Total Return**: ${totalReturn}%\n` +
      `🎯 **Win Rate**: ${winRate}\n` +
      `📈 **Entry Price**: $${result.entryPrice?.toFixed(8) || 'N/A'}\n` +
      `📉 **Final Price**: $${result.finalPrice?.toFixed(8) || 'N/A'}\n` +
      `📊 **Total Candles**: ${result.totalCandles}\n` +
      `🔄 **Events**: ${result.events?.length || 0} trading events\n\n` +
      `Use \`/repeat\` to run this simulation again with different parameters.`;
  }
}