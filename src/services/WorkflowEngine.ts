/**
 * Workflow Engine
 * ===============
 * Handles text-based workflow steps for bot interactions.
 * Extracted from the monolithic bot.ts to improve modularity and testability.
 */

import { Context } from 'telegraf';
import axios from 'axios';
import { DateTime } from 'luxon';
import { SessionService } from './SessionService';
import { CAService } from './CAService';
import { IchimokuService } from './IchimokuService';
import { SimulationService } from './SimulationService';
import { fetchHybridCandles } from '../simulation/candles';
import { simulateStrategy } from '../simulate';
import { saveSimulationRun } from '../utils/database';

export interface WorkflowStepResult {
  shouldContinue: boolean;
  message?: string;
  updatedSession?: any;
}

/**
 * Service for handling text-based workflow steps
 */
export class WorkflowEngine {
  constructor(
    private sessionService: SessionService,
    private caService: CAService,
    private ichimokuService: IchimokuService,
    private simulationService: SimulationService
  ) {}

  /**
   * Handle text message based on current session state
   */
  async handleTextMessage(ctx: Context, text: string): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    const session = this.sessionService.getSession(userId);

    // Ignore Telegram commands at this stage: only handle raw user text input from workflow.
    if (text.startsWith('/')) return;

    // Handle /repeat session, if waiting for user run selection
    if (session?.waitingForRunSelection) {
      await this.handleRunSelection(ctx, text, userId, session);
      return;
    }

    // No active session - attempt CA detection, otherwise ignore other text
    if (!session) {
      await this.handleCADetection(ctx, text, userId);
      return;
    }

    // Active session - progress through workflow steps
    await this.handleWorkflowStep(ctx, text, userId, session);
  }

  /**
   * Handle run selection for /repeat command
   */
  private async handleRunSelection(ctx: Context, text: string, userId: number, session: any): Promise<void> {
    const selection = text.toLowerCase();
    let selectedRun;
    
    if (selection === 'last') {
      selectedRun = session.recentRuns![0];
    } else {
      const runIdx = parseInt(selection) - 1;
      if (runIdx >= 0 && runIdx < session.recentRuns!.length) {
        selectedRun = session.recentRuns![runIdx];
      } else {
        await ctx.reply('❌ Invalid selection. Please choose a number from the list or "last".');
        return;
      }
    }
    
    // Clear selection mode and continue
    this.sessionService.updateSession(userId, { 
      waitingForRunSelection: false, 
      recentRuns: undefined 
    });
    
    await this.repeatSimulation(ctx, selectedRun, userId);
  }

  /**
   * Handle CA detection when no active session
   */
  private async handleCADetection(ctx: Context, text: string, userId: number): Promise<void> {
    const caResult = this.caService.detectCAFromText(text);
    
    if (caResult) {
      const processingResult = await this.caService.processCADrop(
        caResult.mint,
        caResult.chain,
        userId,
        ctx.chat!.id
      );
      
      if (processingResult.success) {
        await ctx.reply(processingResult.message, { parse_mode: 'Markdown' });
      } else {
        await ctx.reply(processingResult.message, { parse_mode: 'Markdown' });
      }
    }
  }

  /**
   * Handle workflow steps based on session type
   */
  private async handleWorkflowStep(ctx: Context, text: string, userId: number, session: any): Promise<void> {
    // Handle Ichimoku workflow
    if (session.type === 'ichimoku') {
      await this.handleIchimokuWorkflow(ctx, text, userId, session);
      return;
    }

    // Handle backtest workflow
    await this.handleBacktestWorkflow(ctx, text, userId, session);
  }

  /**
   * Handle Ichimoku workflow steps
   */
  private async handleIchimokuWorkflow(ctx: Context, text: string, userId: number, session: any): Promise<void> {
    const result = await this.ichimokuService.handleWorkflowStep(text, session, userId);
    
    if (!result.shouldContinue) {
      if (result.message) {
        await ctx.reply(result.message);
      }
      return;
    }

    if (result.updatedSession) {
      this.sessionService.setSession(userId, result.updatedSession);
    }

    // Start Ichimoku analysis
    const analysisResult = await this.ichimokuService.analyzeToken(session.mint, session.chain);
    
    if (analysisResult.success) {
      await ctx.reply(analysisResult.message, { parse_mode: 'Markdown' });
      
      // Start monitoring if analysis was successful
      if (analysisResult.ichimokuData && analysisResult.candles) {
        await this.ichimokuService.startMonitoring({
          userId,
          chatId: ctx.chat!.id,
          mint: session.mint,
          chain: session.chain,
          tokenName: analysisResult.tokenName || 'Unknown',
          tokenSymbol: analysisResult.tokenSymbol || 'N/A',
          callPrice: analysisResult.currentPrice || 0,
          historicalCandles: analysisResult.candles,
          ichimokuData: analysisResult.ichimokuData
        });
      }
    } else {
      await ctx.reply(analysisResult.message, { parse_mode: 'Markdown' });
    }

    // Clear session
    this.sessionService.clearSession(userId);
  }

  /**
   * Handle backtest workflow steps
   */
  private async handleBacktestWorkflow(ctx: Context, text: string, userId: number, session: any): Promise<void> {
    // Step 1: Mint address (detect EVM vs. Solana chain)
    if (!session.mint) {
      session.mint = text;
      if (text.startsWith('0x') && text.length === 42) {
        await ctx.reply('🔗 Detected EVM address.\n\nWhich chain?\n1️⃣ Ethereum (ETH)\n2️⃣ Binance Smart Chain (BSC)\n3️⃣ Base (BASE)\n\nReply with: eth, bsc, or base');
        this.sessionService.setSession(userId, session);
        return;
      } else {
        session.chain = 'solana';
        await ctx.reply('Got the mint. Please provide a simulation start datetime (ISO, e.g. 2025-10-17T03:00:00Z).');
        this.sessionService.setSession(userId, session);
        return;
      }
    }

    // Step 1.5: For EVM, ask for the specific chain
    if (session.mint && !session.chain) {
      const input = text.toLowerCase();
      if (input === 'eth' || input === 'ethereum') {
        session.chain = 'ethereum';
      } else if (input === 'bsc' || input === 'binance') {
        session.chain = 'bsc';
      } else if (input === 'base') {
        session.chain = 'base';
      } else {
        await ctx.reply('❌ Invalid chain. Reply with: eth, bsc, or base');
        return;
      }
      await ctx.reply('Got the chain. Please provide a simulation start datetime (ISO format, e.g. 2025-10-17T03:00:00Z).');
      this.sessionService.setSession(userId, session);
      return;
    }

    // Step 2: Simulation entry date/time
    if (!session.datetime) {
      const dt = DateTime.fromISO(text, { zone: 'utc' });
      if (!dt.isValid) {
        await ctx.reply('Invalid datetime. Use ISO format like 2025-10-17T03:00:00Z.');
        return;
      }
      session.datetime = dt;
      this.sessionService.setSession(userId, session);
      
      try {
        // Fetch token metadata from Birdeye for info/lookup
        console.log(`Fetching metadata for mint: ${session.mint}`);
        const meta = await axios.get(
          'https://public-api.birdeye.so/defi/v3/token/meta-data/single',
          {
            headers: {
              'X-API-KEY': process.env.BIRDEYE_API_KEY!,
              'accept': 'application/json',
              'x-chain': session.chain || 'solana'
            },
            params: {
              address: session.mint
            }
          }
        );

        console.log('Metadata response:', meta.data);
        session.metadata = meta.data.data;
        await ctx.reply(
          `🪙 Token: ${meta.data.data.name} (${meta.data.data.symbol})\n\n` +
          `**Take Profit Strategy:**\n` +
          `• \`yes\` - Default: 50%@2x, 30%@5x, 20%@10x\n` +
          `• \`50@2x,30@5x,20@10x\` - Custom format\n` +
          `• \`[{"percent":0.5,"target":2}]\` - JSON format`,
          { parse_mode: 'Markdown' }
        );
        this.sessionService.setSession(userId, session);
      } catch (e: any) {
        console.error('Metadata fetch error:', e);
        await ctx.reply(`❌ **Failed to fetch token metadata**\n\nError: ${e.response?.data?.message || e.message}\n\nPlease verify the token address and try again.`);
        this.sessionService.clearSession(userId);
      }
      return;
    }

    // Step 3: Strategy configuration
    if (!session.strategy) {
      await this.handleStrategyInput(ctx, text, userId, session);
      return;
    }

    // Step 4: Stop loss configuration
    if (!session.stopLossConfig) {
      await this.handleStopLossInput(ctx, text, userId, session);
      return;
    }

    // Step 5: Run simulation
    await this.runSimulation(ctx, userId, session);
  }

  /**
   * Handle strategy input
   */
  private async handleStrategyInput(ctx: Context, text: string, userId: number, session: any): Promise<void> {
    let strategy;
    
    if (text.toLowerCase() === 'yes') {
      strategy = [
        { percent: 0.5, target: 2 },
        { percent: 0.3, target: 5 },
        { percent: 0.2, target: 10 }
      ];
    } else {
      try {
        // Try to parse custom strategy
        if (text.includes('@')) {
          // Parse format like "50@2x,30@5x,20@10x"
          const parts = text.split(',');
          strategy = parts.map(part => {
            const [percentStr, targetStr] = part.trim().split('@');
            const percent = parseInt(percentStr) / 100;
            const target = parseFloat(targetStr.replace('x', ''));
            return { percent, target };
          });
        } else {
          // Try to parse JSON format
          strategy = JSON.parse(text);
        }
      } catch (e) {
        await ctx.reply('❌ **Invalid strategy format.** Please use:\n• `yes` for default\n• `50@2x,30@5x,20@10x` for custom\n• `[{"percent":0.5,"target":2}]` for JSON');
        return;
      }
    }

    session.strategy = strategy;
    this.sessionService.setSession(userId, session);

    await ctx.reply(
      '📊 **Strategy configured!**\n\n' +
      '**Stop Loss Configuration:**\n' +
      '• `initial:-20%,trailing:30%` - Custom\n' +
      '• `initial:-15%,trailing:none` - No trailing\n' +
      '• `default` - Use default settings',
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * Handle stop loss input
   */
  private async handleStopLossInput(ctx: Context, text: string, userId: number, session: any): Promise<void> {
    let stopLossConfig;
    
    if (text.toLowerCase() === 'default') {
      stopLossConfig = { initial: -0.3, trailing: 0.5 };
    } else {
      try {
        // Parse format like "initial:-20%,trailing:30%"
        const parts = text.split(',');
        const initialPart = parts.find(p => p.includes('initial:'));
        const trailingPart = parts.find(p => p.includes('trailing:'));
        
        const initial = initialPart ? parseFloat(initialPart.split(':')[1].replace('%', '')) / 100 : -0.2;
        const trailing = trailingPart ? 
          (trailingPart.split(':')[1] === 'none' ? 'none' : parseFloat(trailingPart.split(':')[1].replace('%', '')) / 100) : 
          'none';
        
        stopLossConfig = { initial, trailing };
      } catch (e) {
        await ctx.reply('❌ **Invalid stop loss format.** Please use:\n• `default` for default\n• `initial:-20%,trailing:30%` for custom');
        return;
      }
    }

    session.stopLossConfig = stopLossConfig;
    session.entryConfig = { trailingEntry: 'none' as const, maxWaitTime: 60 };
    session.reEntryConfig = { trailingReEntry: 'none' as const, maxReEntries: 0 };
    
    this.sessionService.setSession(userId, session);

    await ctx.reply(
      '✅ **Configuration Complete!**\n\n' +
      'Starting simulation...\n\n' +
      '⏳ Please wait while we fetch data and run the simulation.',
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * Run simulation with current session data
   */
  private async runSimulation(ctx: Context, userId: number, session: any): Promise<void> {
    try {
      const candles = await fetchHybridCandles(
        session.mint,
        session.datetime,
        DateTime.utc(),
        session.chain
      );

      if (!candles.length) {
        await ctx.reply('❌ No candle data available for the specified time period.');
        this.sessionService.clearSession(userId);
        return;
      }

      const result = simulateStrategy(
        candles,
        session.strategy,
        session.stopLossConfig,
        session.entryConfig,
        session.reEntryConfig
      );

      // Format and send results
      const lowestPrice = result.entryOptimization.lowestPrice;
      const lowestPercent = result.entryOptimization.lowestPricePercent;
      const lowestTimeStr = result.entryOptimization.lowestPriceTimeFromEntry! < 60 
        ? `${result.entryOptimization.lowestPriceTimeFromEntry!.toFixed(0)}m`
        : `${(result.entryOptimization.lowestPriceTimeFromEntry! / 60).toFixed(1)}h`;

      const chainEmoji = session.chain === 'solana' ? '🟣' : session.chain === 'ethereum' ? '🔵' : session.chain === 'bsc' ? '🟡' : '⚪';
      
      let resultMessage = `🎯 **Simulation Results**\n\n` +
        `${chainEmoji} Chain: ${session.chain.toUpperCase()}\n` +
        `🪙 Token: ${session.metadata?.name || 'Unknown'} (${session.metadata?.symbol || 'N/A'})\n` +
        `📅 Period: ${session.datetime.toFormat('yyyy-MM-dd HH:mm')} - ${DateTime.utc().toFormat('yyyy-MM-dd HH:mm')}\n` +
        `📈 Candles: ${result.totalCandles}\n` +
        `💰 Final PNL: **${result.finalPnl.toFixed(2)}x**\n\n` +
        `🔍 **Entry Optimization:**\n` +
        `• Lowest Price: $${lowestPrice?.toFixed(8) || 'N/A'} (${lowestPercent?.toFixed(1) || 'N/A'}%)\n` +
        `• Time to Lowest: ${lowestTimeStr}\n\n` +
        `📋 **Key Events:**\n`;

      // Show key events
      const keyEvents = result.events.filter(e => ['entry', 'target_hit', 'stop_loss', 'final_exit'].includes(e.type));
      for (const event of keyEvents.slice(0, 5)) {
        const eventEmoji = event.type === 'entry' ? '🚀' :
          event.type === 'target_hit' ? '🎯' :
          event.type === 'stop_loss' ? '🛑' : '🏁';
        const timestamp = DateTime.fromSeconds(event.timestamp).toFormat('MM-dd HH:mm');
        resultMessage += `${eventEmoji} ${timestamp}: ${event.description}\n`;
      }

      await ctx.reply(resultMessage, { parse_mode: 'Markdown' });

      // Save simulation run
      await saveSimulationRun({
        userId: userId,
        mint: session.mint,
        chain: session.chain,
        tokenName: session.metadata?.name,
        tokenSymbol: session.metadata?.symbol,
        startTime: session.datetime,
        endTime: DateTime.utc(),
        strategy: session.strategy,
        stopLossConfig: session.stopLossConfig,
        finalPnl: result.finalPnl,
        totalCandles: result.totalCandles,
        events: result.events
      });

      // Clear session
      this.sessionService.clearSession(userId);

    } catch (error) {
      console.error('Simulation error:', error);
      await ctx.reply('❌ **Simulation Failed**\n\nAn error occurred during the simulation. Please try again.');
      this.sessionService.clearSession(userId);
    }
  }

  /**
   * Repeat simulation from historical run
   */
  private async repeatSimulation(ctx: Context, run: any, userId: number): Promise<void> {
    const session = {
      mint: run.mint,
      chain: run.chain,
      metadata: {
        name: run.token_name || run.tokenName,
        symbol: run.token_symbol || run.tokenSymbol
      },
      datetime: run.startTime,
      strategy: [{ percent: 0.5, target: 2 }, { percent: 0.3, target: 5 }, { percent: 0.2, target: 10 }],
      stopLossConfig: { initial: -0.3, trailing: 0.5 },
      entryConfig: { trailingEntry: 'none' as const, maxWaitTime: 60 },
      reEntryConfig: { trailingReEntry: 'none' as const, maxReEntries: 0 }
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
