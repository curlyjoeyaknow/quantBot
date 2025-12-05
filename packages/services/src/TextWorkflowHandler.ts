/**
 * Text Workflow Handler
 * =====================
 * Handles the main text workflow for bot interactions including
 * session management, CA detection, and workflow delegation.
 */

import { Context, Markup } from 'telegraf';
import { DateTime } from 'luxon';
import axios from 'axios';
import { SessionService } from './SessionService';
import { SimulationService } from './SimulationService';
import { StrategyService } from './StrategyService';
import { IchimokuWorkflowService } from './IchimokuWorkflowService';
import { CADetectionService } from './CADetectionService';
// TODO: RepeatSimulationHelper moved to bot package
// import { RepeatSimulationHelper } from '@quantbot/bot';
import { findCallsForToken } from '@quantbot/utils';
import { Strategy } from '@quantbot/simulation';
import { StopLossConfig, ReEntryConfig, EntryConfig } from '@quantbot/simulation';
// TODO: SessionData type needs to be defined
// import type { SessionData } from '@quantbot/utils';
type SessionData = any;
import { logger } from '@quantbot/utils';

// Temporary type definitions until bot package is available
type Session = any;
type RepeatSimulationHelper = any;

export class TextWorkflowHandler {
  constructor(
    private sessionService: SessionService,
    private simulationService: SimulationService,
    private strategyService: StrategyService,
    private ichimokuWorkflowService: IchimokuWorkflowService,
    private caDetectionService: CADetectionService,
    private repeatHelper: RepeatSimulationHelper
  ) {}

  /**
   * Ensure session.data is initialized
   */
  private ensureSessionData(session: Session): SessionData {
    if (!session.data) {
      session.data = {};
    }
    return session.data;
  }
  
  async handleCallbackQuery(ctx: Context): Promise<void> {
    try {
      if (!('callback_query' in ctx)) return;
      const callbackQuery = ctx.callbackQuery as any;
      const userId = callbackQuery.from?.id;
      if (!userId) {
        logger.debug('No userId in callback query');
        return;
      }
      
      // Only respond to direct messages
      if (callbackQuery.message && 'chat' in callbackQuery.message && callbackQuery.message.chat.type !== 'private') {
        logger.debug('Ignoring non-private callback query', { userId });
        return;
      }
      
      await ctx.answerCbQuery();
      
      const data = callbackQuery.data;
      if (!data) {
        logger.debug('No data in callback query', { userId });
        return;
      }
      
      logger.debug('Processing callback', { userId, callbackData: data });
    
    // Handle add_curlyjoe callbacks (doesn't require session)
    if (data.startsWith('add_curlyjoe:')) {
      const { AddCurlyJoeCommandHandler } = /* await import('@quantbot/bot')*/ await ({} as any).import('AddCurlyJoeCommandHandler');
      const session = this.sessionService.getSession(userId);
      await AddCurlyJoeCommandHandler.handleCallback(ctx, data, session);
      return;
    }
    
    // Handle watchlist callbacks
    if (data.startsWith('watchlist:')) {
      const { WatchlistCommandHandler } = /* await import('@quantbot/bot')*/ await ({} as any).import('WatchlistCommandHandler');
      await WatchlistCommandHandler.handleCallback(ctx, data);
      return;
    }
    
    const session = this.sessionService.getSession(userId);
    if (!session) {
      logger.debug('No session found for user when handling callback', { userId, callbackData: data });
      await ctx.reply('❌ No active session found. Please start a new backtest with /backtest');
      return;
    }
    
    logger.debug('Processing callback', { userId, callbackData: data, sessionType: session.type });
    
    // Handle backtest source selection
    if (data.startsWith('backtest_source:')) {
      const source = data.replace('backtest_source:', '');
      logger.debug('Handling backtest source selection', { userId, source });
      await this.handleBacktestSourceSelection(ctx, session, source);
      return;
    }
    
    // Handle backtest selection from lists
    if (data.startsWith('backtest_select:')) {
      await this.handleBacktestSelection(ctx, session, data.replace('backtest_select:', ''));
      return;
    }
    
    // Handle caller selection
    if (data.startsWith('backtest_caller:')) {
      await this.handleCallerSelection(ctx, session, data.replace('backtest_caller:', ''));
      return;
    }
    
    // Handle callback data format: "step:value" (e.g., "chain:ethereum", "strategy:default")
    const [step, value] = data.split(':');
    
    // If it's "manual", set a flag and wait for text input
    if (value === 'manual') {
      const data = this.ensureSessionData(session);
      data.waitingManualInput = step;
      this.sessionService.setSession(userId, session);
      await ctx.reply(`✍️ **Manual Entry Mode**\n\nPlease type your ${step} value manually.`);
      return;
    }
    
    // Process the callback value as if it were text input
    const text = value || data;
    await this.handleTextInput(ctx, session, text, step);
    } catch (error) {
      logger.error('Error in handleCallbackQuery', error as Error, { userId: ctx.from?.id });
      await ctx.answerCbQuery('❌ An error occurred. Please try again.');
      if ('reply' in ctx && typeof ctx.reply === 'function') {
        await ctx.reply('❌ An error occurred processing your selection. Please try /backtest again.');
      }
    }
  }
  
  private async handleTextInput(ctx: Context, session: Session, text: string, stepHint?: string): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;
    
    // Handle backtest workflow
    if (session.type === 'backtest') {
      await this.handleBacktestWorkflow(ctx, session, text, stepHint || '');
    }
  }
  
  private async handleBacktestSourceSelection(ctx: Context, session: Session, source: string): Promise<void> {
    try {
      const userId = ctx.from?.id;
      if (!userId) {
        logger.debug('No userId in handleBacktestSourceSelection');
        return;
      }
      
      logger.debug('handleBacktestSourceSelection', { userId, source });
      
      if (source === 'recent_backtests') {
      // Get recent backtests
      const { getUserSimulationRuns } = await import('@quantbot/utils');
      const recentRuns = await getUserSimulationRuns(userId, 10);
      
      if (recentRuns.length === 0) {
        await ctx.reply('📊 **No Recent Backtests**\n\nYou haven\'t run any backtests yet. Please select another option.');
        return;
      }
      
      // Show list of recent backtests
      const buttons = recentRuns.slice(0, 10).map((run: any, idx: number) => {
        const label = `${idx + 1}. ${run.tokenSymbol || 'N/A'} (${run.chain}) - ${(run.finalPnl * 100).toFixed(1)}%`;
        return [Markup.button.callback(label, `backtest_select:run:${run.id}`)];
      });
      
      await ctx.reply(
        '📊 **Select a Recent Backtest:**\n\nChoose one to rerun with new parameters:',
        Markup.inlineKeyboard(buttons)
      );
      if (!session.data) session.data = {};
      const data = this.ensureSessionData(session);
      data.sourceType = 'recent_backtest';
      this.sessionService.setSession(userId, session);
      
    } else if (source === 'recent_calls') {
      // Get recent calls
      const { getRecentCalls } = await import('@quantbot/utils');
      const recentCalls = await getRecentCalls(15);
      
      if (recentCalls.length === 0) {
        await ctx.reply('📞 **No Recent Calls**\n\nNo calls found in the database. Please select another option.');
        return;
      }
      
      // Show list of recent calls
      const buttons = recentCalls.slice(0, 15).map((call: any, idx: number) => {
        const date = new Date(call.alert_timestamp).toISOString().split('T')[0];
        const label = `${idx + 1}. ${call.token_symbol || 'N/A'} - ${call.caller_name} (${date})`;
        return [Markup.button.callback(label, `backtest_select:call:${call.token_address}:${call.chain}`)];
      });
      
      await ctx.reply(
        '📞 **Select a Recent Call:**\n\nChoose a call to backtest:',
        Markup.inlineKeyboard(buttons)
      );
      const data = this.ensureSessionData(session);
      data.sourceType = 'recent_call';
      this.sessionService.setSession(userId, session);
      
    } else if (source === 'by_caller') {
      // Get top callers
      const { getCallerStats } = await import('@quantbot/utils');
      const { topCallers } = await getCallerStats();
      
      if (topCallers.length === 0) {
        await ctx.reply('👤 **No Callers Found**\n\nNo callers found in the database. Please select another option.');
        return;
      }
      
      // Show list of top callers
      const buttons = topCallers.slice(0, 10).map((caller: any, idx: number) => {
        const label = `${idx + 1}. ${caller.caller_name} (${caller.alert_count} calls)`;
        return [Markup.button.callback(label, `backtest_caller:${caller.caller_name}`)];
      });
      
      await ctx.reply(
        '👤 **Select a Caller:**\n\nChoose a caller to see their calls:',
        Markup.inlineKeyboard(buttons)
      );
      const data = this.ensureSessionData(session);
      data.sourceType = 'by_caller';
      this.sessionService.setSession(userId, session);
      
    } else if (source === 'manual') {
      // Manual mint entry
      await ctx.reply('✍️ **Manual Mint Entry**\n\nPlease paste the token address (Solana or EVM) to begin:');
      const data = this.ensureSessionData(session);
      data.sourceType = 'manual';
      data.waitingManualInput = 'mint';
      this.sessionService.setSession(userId, session);
    }
    } catch (error) {
      logger.error('Error in handleBacktestSourceSelection', error as Error, { userId: ctx.from?.id });
      await ctx.reply(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async handleBacktestSelection(ctx: Context, session: Session, selection: string): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;
    
    const [type, ...rest] = selection.split(':');
    
    if (type === 'run') {
      // Selected a recent backtest run
      const runId = parseInt(rest[0]);
      const { getSimulationRun } = await import('@quantbot/utils');
      const run = await getSimulationRun(runId);
      
      if (!run) {
        await ctx.reply('❌ Backtest run not found.');
        return;
      }
      
      // Use the run's mint and chain
      const data = this.ensureSessionData(session);
      data.mint = run.mint;
      data.chain = run.chain;
      data.datetime = run.startTime.toISO();
      data.metadata = {
        name: run.tokenName,
        symbol: run.tokenSymbol
      };
      session.step = 'waiting_for_strategy';
      this.sessionService.setSession(userId, session);
      
      // Show strategy menu
      await ctx.reply(
        `✅ **Selected:** ${run.tokenSymbol || 'N/A'} (${run.chain})\n\n**📈 Select Take Profit Strategy:**`,
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Default (50%@2x, 30%@5x, 20%@10x)', 'strategy:default')],
          [Markup.button.callback('📊 Aggressive (30%@3x, 40%@5x, 30%@10x)', 'strategy:aggressive')],
          [Markup.button.callback('🛡️ Conservative (60%@2x, 30%@3x, 10%@5x)', 'strategy:conservative')],
          [Markup.button.callback('🚀 Moonshot (10%@3x, 10%@5x, 80% ride)', 'strategy:moonshot')],
          [Markup.button.callback('✍️ Manual Entry', 'strategy:manual')]
        ])
      );
      
    } else if (type === 'call') {
      // Selected a recent call
      const tokenAddress = rest[0];
      const chain = rest[1];
      
      const data = this.ensureSessionData(session);
      data.mint = tokenAddress;
      data.chain = chain;
      session.step = 'waiting_for_datetime';
      this.sessionService.setSession(userId, session);
      
      // Show datetime menu
      await ctx.reply(
        `✅ **Selected:** ${tokenAddress.substring(0, 20)}... (${chain})\n\n**📅 Select Simulation Start Date/Time:**`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback('🕐 Now', 'datetime:now'),
            Markup.button.callback('📅 Yesterday', 'datetime:yesterday')
          ],
          [
            Markup.button.callback('📆 7 Days Ago', 'datetime:7days'),
            Markup.button.callback('📆 30 Days Ago', 'datetime:30days')
          ],
          [Markup.button.callback('✍️ Manual Entry', 'datetime:manual')]
        ])
      );
    }
  }
  
  private async handleCallerSelection(ctx: Context, session: Session, callerName: string): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;
    
    // Get calls by this caller
    const { getCACallsByCaller } = await import('@quantbot/utils');
    const calls = await getCACallsByCaller(callerName, 15);
    
    if (calls.length === 0) {
      await ctx.reply(`❌ No calls found for caller: ${callerName}`);
      return;
    }
    
    // Show list of calls by this caller
    const buttons = calls.slice(0, 15).map((call: any, idx: number) => {
      const date = new Date(call.call_timestamp * 1000).toISOString().split('T')[0];
      const label = `${idx + 1}. ${call.token_symbol || 'N/A'} (${date})`;
      return [Markup.button.callback(label, `backtest_select:call:${call.mint}:${call.chain}`)];
    });
    
    await ctx.reply(
      `👤 **Calls by ${callerName}:**\n\nSelect a call to backtest:`,
      Markup.inlineKeyboard(buttons)
    );
    const data = this.ensureSessionData(session);
    data.selectedCaller = callerName;
    this.sessionService.setSession(userId, session);
  }

  async handleText(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }
    
    // Only respond to direct messages (private chats), ignore group/channel messages
    if (ctx.chat?.type !== 'private') {
      return;
    }
    
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim() : '';
    
    // Ignore Telegram commands at this stage: only handle raw user text input from workflow.
    if (text.startsWith('/')) return;
    
    const session = this.sessionService.getSession(userId);
    
    // Check if we're waiting for manual input
    if (session?.data?.waitingManualInput) {
      const data = this.ensureSessionData(session);
      const step = data.waitingManualInput;
      delete data.waitingManualInput;
      this.sessionService.setSession(userId, session);
      await this.handleTextInput(ctx, session, text, step);
      return;
    }
    
    // --- Step: Handle /repeat session, if waiting for user run selection ---
    if (session?.data?.waitingForRunSelection) {
      await this.handleRunSelection(ctx, session, text);
      return;
    }
    
    // --- Step: No active session ‒ attempt CA detection, otherwise ignore ---
    if (!session) {
      // Only try CA detection, don't send default message for every text
      await this.caDetectionService.detectCADrop(ctx, text);
      return;
    }
    
    // --- Workflow: Active session, progress through simulation input steps ---
    
    // Handle Ichimoku workflow
    if (session.type === 'ichimoku') {
      await this.ichimokuWorkflowService.handleIchimokuWorkflow(ctx, session, text);
      return;
    }
    
    // Handle other workflow types (backtest, repeat, etc.)
    logger.debug('TextWorkflowHandler processing', { userId: ctx.from?.id, sessionType: session.type, text: text.substring(0, 50) });
    await this.handleSimulationWorkflow(ctx, session, text);
  }
  
  private async handleRunSelection(ctx: Context, session: Session, text: string): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;
    
    const selection = text.toLowerCase();
    let selectedRun;
    
    if (selection === 'last') {
      const data = this.ensureSessionData(session);
      selectedRun = data.recentRuns?.[0];
    } else {
      const runIdx = parseInt(selection) - 1;
      const data = this.ensureSessionData(session);
      if (runIdx >= 0 && runIdx < (data.recentRuns?.length || 0)) {
        selectedRun = data.recentRuns?.[runIdx];
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

    logger.debug('handleSimulationWorkflow', { sessionType: session.type });
    switch (session.type) {
      case 'backtest':
        logger.debug('Routing to handleBacktestWorkflow');
        await this.handleBacktestWorkflow(ctx, session, text, '');
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

  private async handleBacktestWorkflow(ctx: Context, session: Session, text: string, stepHint: string = ''): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    const data = this.ensureSessionData(session);
    logger.debug('handleBacktestWorkflow called', { mint: data.mint, text });

    // Step 1: Mint address (detect EVM vs. Solana chain)
    if (!data.mint) {
      // Check if we're waiting for manual mint input
      if (data.waitingManualInput === 'mint') {
        delete data.waitingManualInput;
        data.mint = text;
        logger.debug('Setting mint to', { mint: text });
      } else {
        // If no manual input flag, treat as regular text input
        data.mint = text;
        logger.debug('Setting mint to', { mint: text });
      }
      
      // Enhanced: Check if this token has been called before
      try {
        await ctx.reply('🔍 **Checking database for previous calls...**');
        const calls = await findCallsForToken(text);
        
        if (calls.length > 0) {
          // Found calls! Use the most recent one
          const latestCall = calls[0];
          data.chain = latestCall.chain;
          data.datetime = latestCall.alert_timestamp;
          data.callerInfo = latestCall;
          
          const date = new Date(latestCall.alert_timestamp).toISOString().split('T')[0];
          const time = new Date(latestCall.alert_timestamp).toTimeString().substring(0, 5);
          const chainEmoji = latestCall.chain === 'solana' ? '🟣' : latestCall.chain === 'ethereum' ? '🔵' : latestCall.chain === 'bsc' ? '🟡' : '⚪';
          
          await ctx.reply(`✨ **Found ${calls.length} previous call(s)!**\n\n🎯 **Using most recent call:**\n${chainEmoji} **${latestCall.caller_name}** - ${date} ${time}\nToken: ${latestCall.token_symbol || 'N/A'}\nChain: ${latestCall.chain}\n\n**Take Profit Strategy:**\n• \`yes\` - Default: 50%@2x, 30%@5x, 20%@10x\n• \`50@2x,30@5x,20@10x\` - Custom format\n• \`[{"percent":0.5,"target":2}]\` - JSON format`);
          
          this.sessionService.setSession(userId, session);
          return;
        }
      } catch (error: any) {
        logger.error('Error checking database for calls', error as Error, { mint: text });
      }
      
      // No calls found or error - proceed with manual datetime input
      if (text.startsWith('0x') && text.length === 42) {
        await ctx.reply('🔗 Detected EVM address.\n\nWhich chain?\n1️⃣ Ethereum (ETH)\n2️⃣ Binance Smart Chain (BSC)\n3️⃣ Base (BASE)\n\nReply with: eth, bsc, or base');
        this.sessionService.setSession(userId, session);
        return;
      } else {
        data.chain = 'solana';
        await ctx.reply('Got the mint. Please provide a simulation start datetime (ISO, e.g. 2025-10-17T03:00:00Z).');
        this.sessionService.setSession(userId, session);
        return;
      }
    }

    // Step 1.5: For EVM, ask for the specific chain
    if (data.mint && !data.chain) {
      const input = text.toLowerCase();
      if (input === 'eth' || input === 'ethereum') {
        data.chain = 'ethereum';
      } else if (input === 'bsc' || input === 'binance') {
        data.chain = 'bsc';
      } else if (input === 'base') {
        data.chain = 'base';
      } else {
        await ctx.reply('❌ Invalid chain. Reply with: eth, bsc, or base');
        return;
      }
      await ctx.reply('Got the chain. Please provide a simulation start datetime (ISO format, e.g. 2025-10-17T03:00:00Z).');
      this.sessionService.setSession(userId, session);
      return;
    }

    // Step 2: Simulation entry date/time
    if (!data.datetime) {
      // Handle preset datetime options from callback
      if (stepHint === 'datetime' || text.startsWith('datetime:')) {
        const preset = text.replace('datetime:', '');
        let dt: DateTime;
        
        if (preset === 'now') {
          dt = DateTime.utc();
        } else if (preset === 'yesterday') {
          dt = DateTime.utc().minus({ days: 1 });
        } else if (preset === '7days') {
          dt = DateTime.utc().minus({ days: 7 });
        } else if (preset === '30days') {
          dt = DateTime.utc().minus({ days: 30 });
        } else if (preset === 'manual') {
          await ctx.reply('✍️ **Manual Entry**\n\nPlease provide datetime in ISO format (e.g., 2025-10-17T03:00:00Z)');
          data.waitingManualInput = 'datetime';
          this.sessionService.setSession(userId, session);
          return;
        } else {
          // Try parsing as ISO
          dt = DateTime.fromISO(preset, { zone: 'utc' });
          if (!dt.isValid) {
            dt = DateTime.fromISO(text, { zone: 'utc' });
          }
        }
        
        if (!dt.isValid) {
          await ctx.reply('❌ Invalid datetime. Use ISO format like 2025-10-17T03:00:00Z.');
          return;
        }
        data.datetime = dt.toISO() || undefined;
      } else {
        // Text input - try to parse
        const dt = DateTime.fromISO(text, { zone: 'utc' });
        if (!dt.isValid) {
          // Show menu if invalid
          const now = DateTime.utc();
          await ctx.reply(
            '📅 **Select Simulation Start Date/Time:**\n\nChoose a preset or enter manually:',
            Markup.inlineKeyboard([
              [
                Markup.button.callback('🕐 Now', 'datetime:now'),
                Markup.button.callback('📅 Yesterday', 'datetime:yesterday')
              ],
              [
                Markup.button.callback('📆 7 Days Ago', 'datetime:7days'),
                Markup.button.callback('📆 30 Days Ago', 'datetime:30days')
              ],
              [Markup.button.callback('✍️ Manual Entry', 'datetime:manual')]
            ])
          );
          return;
        }
        data.datetime = dt.toISO();
      }
      this.sessionService.setSession(userId, session);
      
      try {
        // Fetch token metadata from Birdeye for info/lookup
        logger.debug('Fetching metadata for mint', { mint: data.mint });
        const meta = await axios.get(`https://public-api.birdeye.so/defi/v3/token/meta-data/single`, {
          headers: {
            'X-API-KEY': process.env.BIRDEYE_API_KEY!,
            'accept': 'application/json',
            'x-chain': data.chain || 'solana'
          },
          params: {
            address: data.mint
          }
        });

        logger.debug('Metadata response', { mint: data.mint, hasData: !!meta.data });
        data.metadata = meta.data.data;
        
        // Show strategy menu
        await ctx.reply(
          `🪙 **Token:** ${meta.data.data.name} (${meta.data.data.symbol})\n\n**📈 Select Take Profit Strategy:**`,
          Markup.inlineKeyboard([
            [Markup.button.callback('✅ Default (50%@2x, 30%@5x, 20%@10x)', 'strategy:default')],
            [Markup.button.callback('📊 Aggressive (30%@3x, 40%@5x, 30%@10x)', 'strategy:aggressive')],
            [Markup.button.callback('🛡️ Conservative (60%@2x, 30%@3x, 10%@5x)', 'strategy:conservative')],
            [Markup.button.callback('🚀 Moonshot (10%@3x, 10%@5x, 80% ride)', 'strategy:moonshot')],
            [Markup.button.callback('✍️ Manual Entry', 'strategy:manual')]
          ])
        );
      } catch (e: any) {
        const err = e as { response?: { status?: number } };
        logger.error('Token metadata error', e as Error, { status: err.response?.status, mint: data.mint });
        if (err.response?.status === 404) {
          data.metadata = { name: 'Unknown', symbol: 'N/A' };
          await ctx.reply(
            `⚠️ **Token not found on Birdeye:** ${data.mint}\n\n**📈 Select Take Profit Strategy:**`,
            Markup.inlineKeyboard([
              [Markup.button.callback('✅ Default (50%@2x, 30%@5x, 20%@10x)', 'strategy:default')],
              [Markup.button.callback('📊 Aggressive (30%@3x, 40%@5x, 30%@10x)', 'strategy:aggressive')],
              [Markup.button.callback('🛡️ Conservative (60%@2x, 30%@3x, 10%@5x)', 'strategy:conservative')],
              [Markup.button.callback('🚀 Moonshot (10%@3x, 10%@5x, 80% ride)', 'strategy:moonshot')],
              [Markup.button.callback('✍️ Manual Entry', 'strategy:manual')]
            ])
          );
        } else {
          await ctx.reply('❌ Failed to fetch token metadata. Check mint address or try again later.');
          return;
        }
      }
      this.sessionService.setSession(userId, session);
      return;
    }

    // Step 3: Take profit strategy configuration
    if (!data.strategy) {
      const defaultStrategy: Strategy[] = [
        { percent: 0.5, target: 2 },
        { percent: 0.3, target: 5 },
        { percent: 0.2, target: 10 }
      ];
      
      const aggressiveStrategy: Strategy[] = [
        { percent: 0.3, target: 3 },
        { percent: 0.4, target: 5 },
        { percent: 0.3, target: 10 }
      ];
      
      const conservativeStrategy: Strategy[] = [
        { percent: 0.6, target: 2 },
        { percent: 0.3, target: 3 },
        { percent: 0.1, target: 5 }
      ];
      
      const moonshotStrategy: Strategy[] = [
        { percent: 0.1, target: 3 },
        { percent: 0.1, target: 5 }
        // 80% rides with trailing stop
      ];

      // Handle strategy selection from callback or text
      if (stepHint === 'strategy' || text.startsWith('strategy:')) {
        const strategyType = text.replace('strategy:', '').toLowerCase();
        
        if (strategyType === 'default' || text.toLowerCase() === 'yes') {
          data.strategy = defaultStrategy;
        } else if (strategyType === 'aggressive') {
          data.strategy = aggressiveStrategy;
        } else if (strategyType === 'conservative') {
          data.strategy = conservativeStrategy;
        } else if (strategyType === 'moonshot') {
          data.strategy = moonshotStrategy;
        } else if (strategyType === 'manual') {
          await ctx.reply('✍️ **Manual Entry**\n\nEnter strategy in format:\n• `50@2x,30@5x,20@10x` (simple)\n• `[{"percent":0.5,"target":2}]` (JSON)');
          data.waitingManualInput = 'strategy';
          this.sessionService.setSession(userId, session);
          return;
        } else {
          // Try parsing as strategy format
          // Fall through to parsing logic below
        }
      } else if (text.toLowerCase() === 'yes') {
        data.strategy = defaultStrategy;
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
          data.strategy = custom;
        } catch {
          await ctx.reply('❌ Invalid strategy format.\n\n**Simple format:** `50@2x,30@5x,20@10x`\n**JSON format:** `[{"percent":0.5,"target":2}]`\n**Default:** `yes`');
          return;
        }
      }
      this.sessionService.setSession(userId, session);
      
      // Show stop loss menu
      await ctx.reply(
        '✅ **Take profit strategy set!**\n\n**🛑 Select Stop Loss Configuration:**',
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Default (-50% initial, 50% trailing)', 'stoploss:default')],
          [Markup.button.callback('🛡️ Tight (-20% initial, 30% trailing)', 'stoploss:tight')],
          [Markup.button.callback('📊 Moderate (-30% initial, 50% trailing)', 'stoploss:moderate')],
          [Markup.button.callback('🚀 Wide (-50% initial, 100% trailing)', 'stoploss:wide')],
          [Markup.button.callback('✍️ Manual Entry', 'stoploss:manual')]
        ])
      );
      return;
    }

    // Step 4: Stop loss configuration
    if (!data.stopLossConfig) {
      const defaultStopLoss: StopLossConfig = {
        initial: -0.5,
        trailing: 0.5
      };
      
      const tightStopLoss: StopLossConfig = {
        initial: -0.2,
        trailing: 0.3
      };
      
      const moderateStopLoss: StopLossConfig = {
        initial: -0.3,
        trailing: 0.5
      };
      
      const wideStopLoss: StopLossConfig = {
        initial: -0.5,
        trailing: 1.0
      };

      // Handle stop loss selection from callback or text
      if (stepHint === 'stoploss' || text.startsWith('stoploss:')) {
        const stopLossType = text.replace('stoploss:', '').toLowerCase();
        
        if (stopLossType === 'default' || text.toLowerCase() === 'default') {
          data.stopLossConfig = defaultStopLoss;
        } else if (stopLossType === 'tight') {
          data.stopLossConfig = tightStopLoss;
        } else if (stopLossType === 'moderate') {
          data.stopLossConfig = moderateStopLoss;
        } else if (stopLossType === 'wide') {
          data.stopLossConfig = wideStopLoss;
        } else if (stopLossType === 'manual') {
          await ctx.reply('✍️ **Manual Entry**\n\nEnter stop loss in format:\n`initial: -30%, trailing: 50%`\n\nExamples:\n• `initial: -20%, trailing: 30%`\n• `initial: -50%, trailing: none`');
          data.waitingManualInput = 'stoploss';
          this.sessionService.setSession(userId, session);
          return;
        } else {
          // Try parsing as stop loss format
          // Fall through to parsing logic below
        }
      } else if (text.toLowerCase() === 'default') {
        data.stopLossConfig = defaultStopLoss;
      } else {
        try {
          const match = text.match(/initial:\s*(-?\d+(?:\.\d+)?)%?,\s*trailing:\s*(\d+(?:\.\d+)?)%?|none/i);
          if (!match) throw new Error();
          
          const initial = parseFloat(match[1]) / 100;
          const trailing = match[2].toLowerCase() === 'none' ? 0 : parseFloat(match[2]) / 100;
          
          data.stopLossConfig = { initial, trailing };
        } catch {
          await ctx.reply('❌ Invalid stop loss format.\n\n**Format:** `initial: -30%, trailing: 50%`\n**Examples:**\n• `initial: -20%, trailing: 30%`\n• `initial: -50%, trailing: none`\n• `default`');
          return;
        }
      }
      this.sessionService.setSession(userId, session);
      
      // Show re-entry menu
      await ctx.reply(
        '✅ **Stop loss configured!**\n\n**🔄 Select Re-entry Configuration:**',
        Markup.inlineKeyboard([
          [Markup.button.callback('❌ No Re-entry (Default)', 'reentry:no')],
          [Markup.button.callback('✅ Allow Re-entry', 'reentry:yes')],
          [Markup.button.callback('✍️ Manual Entry', 'reentry:manual')]
        ])
      );
      return;
    }

    // Step 5: Re-entry configuration
    if (!data.reEntryConfig) {
      const defaultReEntry: ReEntryConfig = { trailingReEntry: 'none' as const, maxReEntries: 0, sizePercent: 0.5 };
      
      // Handle re-entry selection from callback or text
      if (stepHint === 'reentry' || text.startsWith('reentry:')) {
        const reEntryType = text.replace('reentry:', '').toLowerCase();
        
        if (reEntryType === 'yes' || text.toLowerCase() === 'yes') {
          data.reEntryConfig = { trailingReEntry: 0.5, maxReEntries: 3 };
        } else if (reEntryType === 'no' || text.toLowerCase() === 'no' || text.toLowerCase() === 'default') {
          data.reEntryConfig = defaultReEntry;
        } else if (reEntryType === 'manual') {
          await ctx.reply('✍️ **Manual Entry**\n\nEnter re-entry option:\n• `yes` - Allow re-entry\n• `no` - No re-entry');
          data.waitingManualInput = 'reentry';
          this.sessionService.setSession(userId, session);
          return;
        } else {
          await ctx.reply('❌ Invalid re-entry option.');
          return;
        }
      } else if (text.toLowerCase() === 'yes') {
        data.reEntryConfig = { trailingReEntry: 0.5, maxReEntries: 3 };
      } else if (text.toLowerCase() === 'no' || text.toLowerCase() === 'default') {
        data.reEntryConfig = defaultReEntry;
      } else {
        await ctx.reply('❌ Invalid re-entry option.');
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

      const data = this.ensureSessionData(session);
      if (!data.datetime || !data.mint || !data.chain || !data.strategy || !data.stopLossConfig) {
        await ctx.reply('❌ **Missing required configuration.** Please start over.');
        this.sessionService.clearSession(userId);
        return;
      }

      const datetimeStr = typeof data.datetime === 'string' ? data.datetime : data.datetime?.toISO();
      if (!datetimeStr) {
        await ctx.reply('❌ **Missing datetime.** Please start over.');
        this.sessionService.clearSession(userId);
        return;
      }
      const startTime = DateTime.fromISO(datetimeStr);
      const endTime = DateTime.utc();

      const result = await this.simulationService.runSimulation({
        mint: data.mint,
        chain: data.chain,
        startTime,
        endTime,
        strategy: data.strategy,
        stopLossConfig: data.stopLossConfig,
        userId
      });

      // Format and send results
      const strategyText = data.strategy
        .map((s: Strategy) => `${(s.percent * 100).toFixed(0)}%@${s.target}x`)
        .join(', ');
      const stopText = data.stopLossConfig.trailing === 0 || data.stopLossConfig.trailing === 'none'
        ? `${(data.stopLossConfig.initial * 100).toFixed(0)}% initial, none trailing`
        : `${(data.stopLossConfig.initial * 100).toFixed(0)}% initial, ${(typeof data.stopLossConfig.trailing === 'number' ? data.stopLossConfig.trailing * 100 : 0).toFixed(0)}% trailing`;

      let resultMessage = `🎯 **Simulation Complete!**\n\n`;
      resultMessage += `🪙 **Token:** ${data.metadata?.name || 'Unknown'} (${data.metadata?.symbol || 'N/A'})\n`;
      resultMessage += `🔗 **Chain:** ${data.chain.toUpperCase()}\n`;
      resultMessage += `📈 **Strategy:** ${strategyText}\n`;
      resultMessage += `🛑 **Stop Loss:** ${stopText}\n`;
      resultMessage += `⏰ **Period:** ${startTime.toFormat('yyyy-MM-dd HH:mm')} - ${endTime.toFormat('yyyy-MM-dd HH:mm')}\n\n`;
      resultMessage += `📊 **Results:**\n`;
      resultMessage += `• **Total Return:** ${(result.finalPnl * 100).toFixed(2)}%\n`;
      resultMessage += `• **Win Rate:** ${((result.events.filter((e: any) => e.type === 'target_hit').length / result.events.filter((e: any) => e.type === 'target_hit' || e.type === 'stop_loss').length) * 100).toFixed(1)}%\n`;
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
        mint: data.mint,
        chain: data.chain,
        tokenName: data.metadata?.name,
        tokenSymbol: data.metadata?.symbol,
        startTime,
        endTime,
        strategy: data.strategy,
        stopLossConfig: data.stopLossConfig,
        finalPnl: result.finalPnl,
        totalCandles: result.totalCandles,
        events: result.events
      });

      // Clear session
      this.sessionService.clearSession(userId);

    } catch (error: unknown) {
      const err = error as { message?: string };
      const data = this.ensureSessionData(session);
      logger.error('Backtest simulation error', error as Error, { userId, mint: data.mint });
      await ctx.reply(`❌ **Simulation Failed**\n\nError: ${err.message || 'Unknown error'}\n\nPlease try again with a different token or timeframe.`);
      this.sessionService.clearSession(userId);
    }
  }
}
