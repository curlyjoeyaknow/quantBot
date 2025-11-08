/**
 * Text Workflow Handler
 * =====================
 * Handles the main text workflow for bot interactions including
 * session management, CA detection, and workflow delegation.
 */

import { Context } from 'telegraf';
import { DateTime } from 'luxon';
import axios from 'axios';
import { SessionService } from './SessionService';
import { SimulationService } from './SimulationService';
import { StrategyService } from './StrategyService';
import { IchimokuWorkflowService } from './IchimokuWorkflowService';
import { CADetectionService } from './CADetectionService';
import { RepeatSimulationHelper } from '../utils/RepeatSimulationHelper';
import { Session } from '../commands/interfaces/CommandHandler';
import { findCallsForToken } from '../utils/caller-database';
import { Strategy, StopLossConfig } from '../simulate';

export class TextWorkflowHandler {
  constructor(
    private sessionService: SessionService,
    private simulationService: SimulationService,
    private strategyService: StrategyService,
    private ichimokuWorkflowService: IchimokuWorkflowService,
    private caDetectionService: CADetectionService,
    private repeatHelper: RepeatSimulationHelper
  ) {}
  
  async handleText(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }
    
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim() : '';
    
    // Ignore Telegram commands at this stage: only handle raw user text input from workflow.
    if (text.startsWith('/')) return;
    
    const session = this.sessionService.getSession(userId);
    
    // --- Step: Handle /repeat session, if waiting for user run selection ---
    if (session?.data.waitingForRunSelection) {
      await this.handleRunSelection(ctx, session, text);
      return;
    }
    
    // --- Step: No active session ‒ attempt CA detection, otherwise show help ---
    if (!session) {
      if (await this.caDetectionService.detectCADrop(ctx, text)) return;
      
      // Provide helpful default message for unrecognized text
      const defaultMessage = `🤖 **QuantBot**

I didn't recognize that input. Here's what I can do:

**🚀 Quick Start:**
• Send a token address to start tracking it
• Use \`/backtest\` to simulate a trading strategy
• Use \`/options\` to see all available commands

**💡 Tip:** Just paste a token address (Solana or EVM) and I'll automatically start tracking it!

**📱 Commands:**
Use \`/options\` to see the full command list.`;

      await ctx.reply(defaultMessage, { parse_mode: 'Markdown' });
      return;
    }
    
    // --- Workflow: Active session, progress through simulation input steps ---
    
    // Handle Ichimoku workflow
    if (session.type === 'ichimoku') {
      await this.ichimokuWorkflowService.handleIchimokuWorkflow(ctx, session, text);
      return;
    }
    
    // Handle other workflow types (backtest, repeat, etc.)
    console.log('[DEBUG] TextWorkflowHandler: session.type =', session.type, 'text =', text);
    await this.handleSimulationWorkflow(ctx, session, text);
  }
  
  private async handleRunSelection(ctx: Context, session: Session, text: string): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;
    
    const selection = text.toLowerCase();
    let selectedRun;
    
    if (selection === 'last') {
      selectedRun = session.data.recentRuns?.[0];
    } else {
      const runIdx = parseInt(selection) - 1;
      if (runIdx >= 0 && runIdx < (session.data.recentRuns?.length || 0)) {
        selectedRun = session.data.recentRuns?.[runIdx];
      } else {
        await ctx.reply('❌ Invalid selection. Please choose a number from the list or "last".');
        return;
      }
    }
    
    if (!selectedRun) {
      await ctx.reply('❌ No valid run selected.');
      return;
    }
    
    // Clear selection mode and continue
    const updatedSession: Session = {
      ...session,
      data: {
        ...session.data,
        waitingForRunSelection: false,
        recentRuns: undefined
      }
    };
    
    this.sessionService.setSession(userId, updatedSession);
    await this.repeatHelper.repeatSimulation(ctx, selectedRun);
  }
  
  private async handleSimulationWorkflow(ctx: Context, session: Session, text: string): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    console.log('[DEBUG] handleSimulationWorkflow: session.type =', session.type);
    switch (session.type) {
      case 'backtest':
        console.log('[DEBUG] Routing to handleBacktestWorkflow');
        await this.handleBacktestWorkflow(ctx, session, text);
        break;
      case 'repeat':
        await ctx.reply('🔄 Repeat workflow in progress...');
        break;
      default:
        await ctx.reply('❓ Unknown workflow type. Please start over with /backtest or /repeat.');
        this.sessionService.clearSession(userId);
        break;
    }
  }

  private async handleBacktestWorkflow(ctx: Context, session: Session, text: string): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    console.log('[DEBUG] handleBacktestWorkflow called with mint:', session.data.mint, 'text:', text);

    // Step 1: Mint address (detect EVM vs. Solana chain)
    if (!session.data.mint) {
      session.data.mint = text;
      console.log('[DEBUG] Setting mint to:', text);
      
      // Enhanced: Check if this token has been called before
      try {
        await ctx.reply('🔍 **Checking database for previous calls...**');
        const calls = await findCallsForToken(text);
        
        if (calls.length > 0) {
          // Found calls! Use the most recent one
          const latestCall = calls[0];
          session.data.chain = latestCall.chain;
          session.data.datetime = latestCall.alert_timestamp;
          session.data.callerInfo = latestCall;
          
          const date = new Date(latestCall.alert_timestamp).toISOString().split('T')[0];
          const time = new Date(latestCall.alert_timestamp).toTimeString().substring(0, 5);
          const chainEmoji = latestCall.chain === 'solana' ? '🟣' : latestCall.chain === 'ethereum' ? '🔵' : latestCall.chain === 'bsc' ? '🟡' : '⚪';
          
          await ctx.reply(`✨ **Found ${calls.length} previous call(s)!**\n\n🎯 **Using most recent call:**\n${chainEmoji} **${latestCall.caller_name}** - ${date} ${time}\nToken: ${latestCall.token_symbol || 'N/A'}\nChain: ${latestCall.chain}\n\n**Take Profit Strategy:**\n• \`yes\` - Default: 50%@2x, 30%@5x, 20%@10x\n• \`50@2x,30@5x,20@10x\` - Custom format\n• \`[{"percent":0.5,"target":2}]\` - JSON format`);
          
          this.sessionService.setSession(userId, session);
          return;
        }
      } catch (error: any) {
        console.log('Error checking database for calls:', error.message);
      }
      
      // No calls found or error - proceed with manual datetime input
      if (text.startsWith('0x') && text.length === 42) {
        await ctx.reply('🔗 Detected EVM address.\n\nWhich chain?\n1️⃣ Ethereum (ETH)\n2️⃣ Binance Smart Chain (BSC)\n3️⃣ Base (BASE)\n\nReply with: eth, bsc, or base');
        this.sessionService.setSession(userId, session);
        return;
      } else {
        session.data.chain = 'solana';
        await ctx.reply('Got the mint. Please provide a simulation start datetime (ISO, e.g. 2025-10-17T03:00:00Z).');
        this.sessionService.setSession(userId, session);
        return;
      }
    }

    // Step 1.5: For EVM, ask for the specific chain
    if (session.data.mint && !session.data.chain) {
      const input = text.toLowerCase();
      if (input === 'eth' || input === 'ethereum') {
        session.data.chain = 'ethereum';
      } else if (input === 'bsc' || input === 'binance') {
        session.data.chain = 'bsc';
      } else if (input === 'base') {
        session.data.chain = 'base';
      } else {
        await ctx.reply('❌ Invalid chain. Reply with: eth, bsc, or base');
        return;
      }
      await ctx.reply('Got the chain. Please provide a simulation start datetime (ISO format, e.g. 2025-10-17T03:00:00Z).');
      this.sessionService.setSession(userId, session);
      return;
    }

    // Step 2: Simulation entry date/time
    if (!session.data.datetime) {
      const dt = DateTime.fromISO(text, { zone: 'utc' });
      if (!dt.isValid) {
        await ctx.reply('Invalid datetime. Use ISO format like 2025-10-17T03:00:00Z.');
        return;
      }
      session.data.datetime = dt.toISO();
      this.sessionService.setSession(userId, session);
      
      try {
        // Fetch token metadata from Birdeye for info/lookup
        console.log(`Fetching metadata for mint: ${session.data.mint}`);
        const meta = await axios.get(`https://public-api.birdeye.so/defi/v3/token/meta-data/single`, {
          headers: {
            'X-API-KEY': process.env.BIRDEYE_API_KEY!,
            'accept': 'application/json',
            'x-chain': session.data.chain || 'solana'
          },
          params: {
            address: session.data.mint
          }
        });

        console.log('Metadata response:', meta.data);
        session.data.metadata = meta.data.data;
        await ctx.reply(`🪙 Token: ${meta.data.data.name} (${meta.data.data.symbol})\n\n**Take Profit Strategy:**\n• \`yes\` - Default: 50%@2x, 30%@5x, 20%@10x\n• \`50@2x,30@5x,20@10x\` - Custom format\n• \`[{"percent":0.5,"target":2}]\` - JSON format`);
      } catch (e: any) {
        console.error('Token metadata error:', e.response?.status, e.response?.data);
        if (e.response?.status === 404) {
          await ctx.reply(`⚠️ Token not found on Birdeye: ${session.data.mint}\n\n**Take Profit Strategy:**\n• \`yes\` - Default: 50%@2x, 30%@5x, 20%@10x\n• \`50@2x,30@5x,20@10x\` - Custom format\n• \`[{"percent":0.5,"target":2}]\` - JSON format`);
          session.data.metadata = { name: 'Unknown', symbol: 'N/A' };
        } else {
          await ctx.reply('❌ Failed to fetch token metadata. Check mint address or try again later.');
          return;
        }
      }
      this.sessionService.setSession(userId, session);
      return;
    }

    // Step 3: Take profit strategy configuration
    if (!session.data.strategy) {
      const defaultStrategy: Strategy[] = [
        { percent: 0.5, target: 2 },
        { percent: 0.3, target: 5 },
        { percent: 0.2, target: 10 }
      ];

      if (text.toLowerCase() === 'yes') {
        session.data.strategy = defaultStrategy;
      } else {
        // Parse either the simple or JSON format
        try {
          let custom: Strategy[];
          if (text.includes('@') && text.includes('x')) {
            const parts = text.split(',').map(part => part.trim());
            custom = parts.map(part => {
              const [percentStr, targetStr] = part.split('@');
              const percent = parseFloat(percentStr) / 100;
              const target = parseFloat(targetStr.replace('x', ''));
              return { percent, target };
            });
          } else {
            custom = JSON.parse(text);
            if (!Array.isArray(custom)) throw new Error();
          }
          const totalPercent = custom.reduce((sum, step) => sum + step.percent, 0);
          if (Math.abs(totalPercent - 1) > 0.01) {
            await ctx.reply(`❌ Strategy percentages must add up to 100%. Current total: ${(totalPercent * 100).toFixed(1)}%\n\nTry: "50@2x,30@5x,20@10x" or "yes" for default`);
            return;
          }
          session.data.strategy = custom;
        } catch {
          await ctx.reply('❌ Invalid strategy format.\n\n**Simple format:** `50@2x,30@5x,20@10x`\n**JSON format:** `[{"percent":0.5,"target":2}]`\n**Default:** `yes`');
          return;
        }
      }
      this.sessionService.setSession(userId, session);
      await ctx.reply('✅ Take profit strategy set!\n\n**Stop Loss Configuration:**\nFormat: `initial: -30%, trailing: 50%`\n\nExamples:\n• `initial: -20%, trailing: 30%`\n• `initial: -50%, trailing: 100%`\n• `initial: -30%, trailing: none`\n• `default` - Use default (-50% initial, 50% trailing)\n\n*Next: Re-entry configuration*');
      return;
    }

    // Step 4: Stop loss configuration
    if (!session.data.stopLossConfig) {
      const defaultStopLoss: StopLossConfig = {
        initial: -0.5,
        trailing: 0.5
      };

      if (text.toLowerCase() === 'default') {
        session.data.stopLossConfig = defaultStopLoss;
      } else {
        try {
          const match = text.match(/initial:\s*(-?\d+(?:\.\d+)?)%?,\s*trailing:\s*(\d+(?:\.\d+)?)%?|none/i);
          if (!match) throw new Error();
          
          const initial = parseFloat(match[1]) / 100;
          const trailing = match[2].toLowerCase() === 'none' ? 0 : parseFloat(match[2]) / 100;
          
          session.data.stopLossConfig = { initial, trailing };
        } catch {
          await ctx.reply('❌ Invalid stop loss format.\n\n**Format:** `initial: -30%, trailing: 50%`\n**Examples:**\n• `initial: -20%, trailing: 30%`\n• `initial: -50%, trailing: none`\n• `default`');
          return;
        }
      }
      this.sessionService.setSession(userId, session);
      await ctx.reply('✅ Stop loss configured!\n\n**Re-entry Configuration:**\n• `yes` - Allow re-entry after stop loss\n• `no` - No re-entry after stop loss\n• `default` - Use default (no re-entry)');
      return;
    }

    // Step 5: Re-entry configuration
    if (!session.data.reEntryConfig) {
      const defaultReEntry = { enabled: false };
      
      if (text.toLowerCase() === 'yes') {
        session.data.reEntryConfig = { enabled: true };
      } else if (text.toLowerCase() === 'no' || text.toLowerCase() === 'default') {
        session.data.reEntryConfig = defaultReEntry;
      } else {
        await ctx.reply('❌ Invalid re-entry option.\n\n**Options:**\n• `yes` - Allow re-entry after stop loss\n• `no` - No re-entry after stop loss\n• `default` - Use default (no re-entry)');
        return;
      }
      this.sessionService.setSession(userId, session);
      
      // All configuration complete - run simulation
      await this.runBacktestSimulation(ctx, session);
    }
  }

  private async runBacktestSimulation(ctx: Context, session: Session): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
      await ctx.reply('🚀 **Running simulation...**\n\nThis may take a moment while fetching candle data...');

      const startTime = DateTime.fromISO(session.data.datetime);
      const endTime = DateTime.utc();

      const result = await this.simulationService.runSimulation({
        mint: session.data.mint,
        chain: session.data.chain,
        startTime,
        endTime,
        strategy: session.data.strategy,
        stopLossConfig: session.data.stopLossConfig,
        userId
      });

      // Format and send results
      const strategyText = session.data.strategy
        .map((s: Strategy) => `${(s.percent * 100).toFixed(0)}%@${s.target}x`)
        .join(', ');
      const stopText = session.data.stopLossConfig.trailing === 0
        ? `${(session.data.stopLossConfig.initial * 100).toFixed(0)}% initial, none trailing`
        : `${(session.data.stopLossConfig.initial * 100).toFixed(0)}% initial, ${(session.data.stopLossConfig.trailing * 100).toFixed(0)}% trailing`;

      let resultMessage = `🎯 **Simulation Complete!**\n\n`;
      resultMessage += `🪙 **Token:** ${session.data.metadata?.name || 'Unknown'} (${session.data.metadata?.symbol || 'N/A'})\n`;
      resultMessage += `🔗 **Chain:** ${session.data.chain.toUpperCase()}\n`;
      resultMessage += `📈 **Strategy:** ${strategyText}\n`;
      resultMessage += `🛑 **Stop Loss:** ${stopText}\n`;
      resultMessage += `⏰ **Period:** ${startTime.toFormat('yyyy-MM-dd HH:mm')} - ${endTime.toFormat('yyyy-MM-dd HH:mm')}\n\n`;
      resultMessage += `📊 **Results:**\n`;
      resultMessage += `• **Total Return:** ${(result.finalPnl * 100).toFixed(2)}%\n`;
      resultMessage += `• **Win Rate:** ${((result.events.filter(e => e.type === 'target_hit').length / result.events.filter(e => e.type === 'target_hit' || e.type === 'stop_loss').length) * 100).toFixed(1)}%\n`;
      resultMessage += `• **Total Candles:** ${result.totalCandles}\n`;
      resultMessage += `• **Events:** ${result.events.length}\n\n`;

      if (result.events.length > 0) {
        resultMessage += `📋 **Recent Events:**\n`;
        const recentEvents = result.events.slice(-5);
        for (const event of recentEvents) {
          const eventEmoji = event.type === 'target_hit' ? '💰' : event.type === 'stop_loss' ? '🛑' : '🏁';
          const timestamp = DateTime.fromSeconds(event.timestamp).toFormat('MM-dd HH:mm');
          resultMessage += `${eventEmoji} ${timestamp}: ${event.description}\n`;
        }
      }

      await ctx.reply(resultMessage, { parse_mode: 'Markdown' });

      // Save this backtest run
      await this.simulationService.saveSimulationRun({
        userId: userId,
        mint: session.data.mint,
        chain: session.data.chain,
        tokenName: session.data.metadata?.name,
        tokenSymbol: session.data.metadata?.symbol,
        startTime,
        endTime,
        strategy: session.data.strategy,
        stopLossConfig: session.data.stopLossConfig,
        finalPnl: result.finalPnl,
        totalCandles: result.totalCandles,
        events: result.events
      });

      // Clear session
      this.sessionService.clearSession(userId);

    } catch (error: any) {
      console.error('Backtest simulation error:', error);
      await ctx.reply(`❌ **Simulation Failed**\n\nError: ${error.message}\n\nPlease try again with a different token or timeframe.`);
      this.sessionService.clearSession(userId);
    }
  }
}
