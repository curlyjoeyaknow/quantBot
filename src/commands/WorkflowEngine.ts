/**
 * Workflow Engine
 * ===============
 * Manages multi-step user workflows and state transitions
 */

import { Context } from 'telegraf';
import { Session } from './interfaces/CommandHandler';
import { CAService } from '../services/CAService';
import { IchimokuService } from '../services/IchimokuService';

export interface WorkflowStep {
  name: string;
  handler: (ctx: Context, session: Session, data: any) => Promise<void>;
  nextStep?: string;
  validation?: (data: any) => boolean;
}

export class WorkflowEngine {
  private workflows: Map<string, Map<string, WorkflowStep>> = new Map();

  constructor(
    private caService: CAService,
    private ichimokuService: IchimokuService
  ) {
    this.initializeWorkflows();
  }

  private initializeWorkflows(): void {
    // Backtest workflow
    const backtestWorkflow = new Map<string, WorkflowStep>();
    
    backtestWorkflow.set('waiting_for_token', {
      name: 'waiting_for_token',
      handler: this.handleTokenInput.bind(this),
      nextStep: 'waiting_for_strategy'
    });
    
    backtestWorkflow.set('waiting_for_strategy', {
      name: 'waiting_for_strategy',
      handler: this.handleStrategyInput.bind(this),
      nextStep: 'waiting_for_stop_loss'
    });
    
    backtestWorkflow.set('waiting_for_stop_loss', {
      name: 'waiting_for_stop_loss',
      handler: this.handleStopLossInput.bind(this),
      nextStep: 'waiting_for_entry_config'
    });
    
    backtestWorkflow.set('waiting_for_entry_config', {
      name: 'waiting_for_entry_config',
      handler: this.handleEntryConfigInput.bind(this),
      nextStep: 'waiting_for_re_entry_config'
    });
    
    backtestWorkflow.set('waiting_for_re_entry_config', {
      name: 'waiting_for_re_entry_config',
      handler: this.handleReEntryConfigInput.bind(this)
    });

    // Strategy workflow
    const strategyWorkflow = new Map<string, WorkflowStep>();
    
    strategyWorkflow.set('waiting_for_strategy_config', {
      name: 'waiting_for_strategy_config',
      handler: this.handleStrategyConfigInput.bind(this)
    });

    // Ichimoku workflow
    const ichimokuWorkflow = new Map<string, WorkflowStep>();
    
    ichimokuWorkflow.set('waiting_for_token', {
      name: 'waiting_for_token',
      handler: this.handleIchimokuTokenInput.bind(this),
      nextStep: 'waiting_for_timeframe'
    });
    
    ichimokuWorkflow.set('waiting_for_timeframe', {
      name: 'waiting_for_timeframe',
      handler: this.handleIchimokuTimeframeInput.bind(this)
    });

    this.workflows.set('backtest', backtestWorkflow);
    this.workflows.set('strategy', strategyWorkflow);
    this.workflows.set('ichimoku', ichimokuWorkflow);
  }

  async processStep(ctx: Context, session: Session): Promise<void> {
    const workflow = this.workflows.get(session.type || '');
    if (!workflow) {
      await ctx.reply('❌ Unknown workflow type');
      return;
    }

    const step = workflow.get(session.step || '');
    if (!step) {
      await ctx.reply('❌ Unknown workflow step');
      return;
    }

    try {
      await step.handler(ctx, session, session.data || {});
    } catch (error) {
      console.error('Workflow step error:', error);
      await ctx.reply('❌ An error occurred while processing your input. Please try again.');
    }
  }

  private async handleTokenInput(ctx: Context, session: Session, data: any): Promise<void> {
    const message = (ctx.message as any)?.text || '';
    
    // Detect CA drop or extract token address
    const caDrop = this.caService.detectCADrop(message);
    if (caDrop) {
      session.mint = caDrop.mint;
      session.chain = caDrop.chain;
      session.step = 'waiting_for_strategy';
      session.data = { ...data, ...caDrop };
      
      await ctx.reply(`✅ **Token Detected!**\n\n` +
        `🪙 **Address**: \`${caDrop.mint}\`\n` +
        `🔗 **Chain**: ${caDrop.chain.toUpperCase()}\n\n` +
        `Now please provide your strategy configuration:\n\n` +
        `**Format:** \`percent1:target1,percent2:target2\`\n\n` +
        `**Example:** \`0.5:2.0,0.3:3.0,0.2:5.0\`\n\n` +
        `This means:\n` +
        `• 50% at 2x (100% profit)\n` +
        `• 30% at 3x (200% profit)\n` +
        `• 20% at 5x (400% profit)`);
    } else {
      await ctx.reply('❌ **Invalid Token Address**\n\nPlease provide a valid Solana or Ethereum token address.\n\n**Examples:**\n• `So11111111111111111111111111111111111111112` (Solana)\n• `0x1234567890123456789012345678901234567890` (Ethereum)');
    }
  }

  private async handleStrategyInput(ctx: Context, session: Session, data: any): Promise<void> {
    const message = (ctx.message as any)?.text || '';
    
    try {
      const strategy = this.parseStrategy(message);
      session.strategy = strategy;
      session.step = 'waiting_for_stop_loss';
      session.data = { ...data, strategy };
      
      await ctx.reply(`✅ **Strategy Configured!**\n\n` +
        `📊 **Your Strategy:**\n` +
        strategy.map(s => `• ${s.percent * 100}% at ${s.target}x (${(s.target - 1) * 100}% profit)`).join('\n') +
        `\n\nNow please provide your stop loss configuration:\n\n` +
        `**Format:** \`initial:trailing\`\n\n` +
        `**Examples:**\n` +
        `• \`-0.2:none\` (20% initial stop loss, no trailing)\n` +
        `• \`-0.1:0.05\` (10% initial, 5% trailing)\n` +
        `• \`-0.3:none\` (30% initial stop loss)`);
    } catch (error) {
      await ctx.reply('❌ **Invalid Strategy Format**\n\nPlease use the format: `percent1:target1,percent2:target2`\n\n**Example:** `0.5:2.0,0.3:3.0,0.2:5.0`');
    }
  }

  private async handleStopLossInput(ctx: Context, session: Session, data: any): Promise<void> {
    const message = (ctx.message as any)?.text || '';
    
    try {
      const stopLossConfig = this.parseStopLossConfig(message);
      session.stopLossConfig = stopLossConfig;
      session.step = 'waiting_for_entry_config';
      session.data = { ...data, stopLossConfig };
      
      await ctx.reply(`✅ **Stop Loss Configured!**\n\n` +
        `🛑 **Stop Loss:**\n` +
        `• Initial: ${stopLossConfig.initial * 100}%\n` +
        `• Trailing: ${stopLossConfig.trailing === 'none' ? 'None' : stopLossConfig.trailing * 100 + '%'}\n\n` +
        `Now please provide your entry configuration:\n\n` +
        `**Format:** \`trailing_entry:max_wait_time\`\n\n` +
        `**Examples:**\n` +
        `• \`none:0\` (No trailing entry)\n` +
        `• \`0.05:60\` (5% trailing entry, 60 second max wait)\n` +
        `• \`0.1:120\` (10% trailing entry, 2 minute max wait)`);
    } catch (error) {
      await ctx.reply('❌ **Invalid Stop Loss Format**\n\nPlease use the format: `initial:trailing`\n\n**Examples:**\n• `-0.2:none`\n• `-0.1:0.05`');
    }
  }

  private async handleEntryConfigInput(ctx: Context, session: Session, data: any): Promise<void> {
    const message = (ctx.message as any)?.text || '';
    
    try {
      const entryConfig = this.parseEntryConfig(message);
      session.entryConfig = entryConfig;
      session.step = 'waiting_for_re_entry_config';
      session.data = { ...data, entryConfig };
      
      await ctx.reply(`✅ **Entry Configuration Set!**\n\n` +
        `📈 **Entry Config:**\n` +
        `• Trailing Entry: ${entryConfig.trailingEntry === 'none' ? 'None' : entryConfig.trailingEntry * 100 + '%'}\n` +
        `• Max Wait Time: ${entryConfig.maxWaitTime} seconds\n\n` +
        `Finally, please provide your re-entry configuration:\n\n` +
        `**Format:** \`trailing_re_entry:max_re_entries\`\n\n` +
        `**Examples:**\n` +
        `• \`none:0\` (No re-entry)\n` +
        `• \`0.05:1\` (5% trailing re-entry, max 1 re-entry)\n` +
        `• \`0.1:3\` (10% trailing re-entry, max 3 re-entries)`);
    } catch (error) {
      await ctx.reply('❌ **Invalid Entry Config Format**\n\nPlease use the format: `trailing_entry:max_wait_time`\n\n**Examples:**\n• `none:0`\n• `0.05:60`');
    }
  }

  private async handleReEntryConfigInput(ctx: Context, session: Session, data: any): Promise<void> {
    const message = (ctx.message as any)?.text || '';
    
    try {
      const reEntryConfig = this.parseReEntryConfig(message);
      session.reEntryConfig = reEntryConfig;
      
      // Complete the workflow
      await this.completeBacktestWorkflow(ctx, session);
    } catch (error) {
      await ctx.reply('❌ **Invalid Re-entry Config Format**\n\nPlease use the format: `trailing_re_entry:max_re_entries`\n\n**Examples:**\n• `none:0`\n• `0.05:1`');
    }
  }

  private async handleStrategyConfigInput(ctx: Context, session: Session, data: any): Promise<void> {
    const message = (ctx.message as any)?.text || '';
    
    try {
      const strategy = this.parseStrategy(message);
      const stopLossConfig = this.parseStopLossConfig('-0.2:none');
      const entryConfig = this.parseEntryConfig('none:0');
      const reEntryConfig = this.parseReEntryConfig('none:0');
      
      // Save strategy
      await this.caService.saveStrategy(session.userId!, session.strategyName!, {
        strategy,
        stopLossConfig,
        entryConfig,
        reEntryConfig
      });
      
      await ctx.reply(`✅ **Strategy "${session.strategyName}" Saved Successfully!**\n\n` +
        `📊 **Strategy:**\n` +
        strategy.map(s => `• ${s.percent * 100}% at ${s.target}x`).join('\n') +
        `\n\nYou can now use this strategy with \`/strategy use ${session.strategyName}\``);
      
      // Clear session
      session.step = undefined;
      session.type = undefined;
      session.data = undefined;
      session.strategyName = undefined;
    } catch (error) {
      await ctx.reply('❌ **Invalid Strategy Format**\n\nPlease use the format: `percent1:target1,percent2:target2`\n\n**Example:** `0.5:2.0,0.3:3.0,0.2:5.0`');
    }
  }

  private async handleIchimokuTokenInput(ctx: Context, session: Session, data: any): Promise<void> {
    const message = (ctx.message as any)?.text || '';
    
    // Detect CA drop or extract token address
    const caDrop = this.caService.detectCADrop(message);
    if (caDrop) {
      session.mint = caDrop.mint;
      session.chain = caDrop.chain;
      session.step = 'waiting_for_timeframe';
      session.data = { ...data, ...caDrop };
      
      await ctx.reply(`✅ **Token Detected!**\n\n` +
        `🪙 **Address**: \`${caDrop.mint}\`\n` +
        `🔗 **Chain**: ${caDrop.chain.toUpperCase()}\n\n` +
        `Now please provide the timeframe for analysis:\n\n` +
        `**Options:**\n` +
        `• \`1h\` - 1 hour candles\n` +
        `• \`4h\` - 4 hour candles\n` +
        `• \`1d\` - 1 day candles\n\n` +
        `**Example:** \`1h\``);
    } else {
      await ctx.reply('❌ **Invalid Token Address**\n\nPlease provide a valid Solana or Ethereum token address.');
    }
  }

  private async handleIchimokuTimeframeInput(ctx: Context, session: Session, data: any): Promise<void> {
    const message = (ctx.message as any)?.text || '';
    
    const validTimeframes = ['1h', '4h', '1d'];
    if (!validTimeframes.includes(message.toLowerCase())) {
      await ctx.reply('❌ **Invalid Timeframe**\n\nPlease choose from: `1h`, `4h`, `1d`');
      return;
    }
    
    try {
      await this.ichimokuService.startIchimokuAnalysis(ctx, session.mint!, session.chain!, message.toLowerCase());
      
      // Clear session
      session.step = undefined;
      session.type = undefined;
      session.data = undefined;
      session.mint = undefined;
      session.chain = undefined;
    } catch (error) {
      console.error('Ichimoku analysis error:', error);
      await ctx.reply('❌ **Analysis Failed**\n\nAn error occurred while starting the Ichimoku analysis.');
    }
  }

  private async completeBacktestWorkflow(ctx: Context, session: Session): Promise<void> {
    try {
      // Run simulation
      const result = await this.caService.runSimulation({
        userId: session.userId!,
        chatId: ctx.chat?.id || session.userId!,
        mint: session.mint!,
        chain: session.chain!,
        strategy: session.strategy!,
        stopLossConfig: session.stopLossConfig!,
        entryConfig: session.entryConfig!,
        reEntryConfig: session.reEntryConfig!
      });
      
      // Format and send results
      const pnlPercent = result.finalPnl * 100;
      const pnlEmoji = pnlPercent >= 0 ? '📈' : '📉';
      
      await ctx.reply(`${pnlEmoji} **Simulation Complete!**\n\n` +
        `🪙 **Token**: ${session.mint}\n` +
        `🔗 **Chain**: ${session.chain?.toUpperCase()}\n` +
        `📊 **Final PnL**: ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%\n` +
        `💰 **Entry Price**: $${result.entryPrice?.toFixed(8) || 'N/A'}\n` +
        `💎 **Final Price**: $${result.finalPrice?.toFixed(8) || 'N/A'}\n` +
        `📈 **Total Candles**: ${result.totalCandles}\n\n` +
        `**Events:**\n` +
        result.events.map(e => `• ${e.description}`).join('\n'));
      
      // Clear session
      session.step = undefined;
      session.type = undefined;
      session.data = undefined;
      session.mint = undefined;
      session.chain = undefined;
      session.strategy = undefined;
      session.stopLossConfig = undefined;
      session.entryConfig = undefined;
      session.reEntryConfig = undefined;
    } catch (error) {
      console.error('Backtest workflow completion error:', error);
      await ctx.reply('❌ **Simulation Failed**\n\nAn error occurred while running the simulation.');
    }
  }

  private parseStrategy(input: string): any[] {
    const parts = input.split(',');
    return parts.map(part => {
      const [percent, target] = part.split(':');
      return {
        percent: parseFloat(percent),
        target: parseFloat(target)
      };
    });
  }

  private parseStopLossConfig(input: string): any {
    const [initial, trailing] = input.split(':');
    return {
      initial: parseFloat(initial),
      trailing: trailing === 'none' ? 'none' : parseFloat(trailing)
    };
  }

  private parseEntryConfig(input: string): any {
    const [trailingEntry, maxWaitTime] = input.split(':');
    return {
      trailingEntry: trailingEntry === 'none' ? 'none' : parseFloat(trailingEntry),
      maxWaitTime: parseInt(maxWaitTime)
    };
  }

  private parseReEntryConfig(input: string): any {
    const [trailingReEntry, maxReEntries] = input.split(':');
    return {
      trailingReEntry: trailingReEntry === 'none' ? 'none' : parseFloat(trailingReEntry),
      maxReEntries: parseInt(maxReEntries)
    };
  }
}
