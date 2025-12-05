/**
 * Add CurlyJoe Command Handler
 * ============================
 * Allows users to easily add recent calls from CurlyJoe channel to live monitoring
 * with Ichimoku and price/volume alerts configured by default.
 */

import { Context, Markup } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { callerDatabase, CallerAlert } from '@quantbot/storage/caller-database';
import { LiveTradeAlertService } from '@quantbot/monitoring/live-trade-alert-service';
import { logger } from '@quantbot/utils';
import { EntryConfig } from '@quantbot/simulation/config';
import { fetchHistoricalCandlesForMonitoring } from '../utils/fetch-historical-candles';
import { sessionService } from '@quantbot/services/SessionService';

// Default entry configuration with Ichimoku and price alerts enabled
const DEFAULT_MONITOR_CONFIG: EntryConfig = {
  initialEntry: -0.1, // Wait for 10% price drop from alert price
  trailingEntry: 0.05, // Enter on 5% rebound from low
  maxWaitTime: 60, // 60 minutes max wait
};

// CurlyJoe caller name variations
const CURLYJOE_NAMES = ['curlyjoe', 'curly joe', 'curly', '@curlyjoe'];

export class AddCurlyJoeCommandHandler extends BaseCommandHandler {
  readonly command = 'addcurlyjoe';

  async execute(ctx: Context, session?: Session): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await this.sendError(ctx, 'Unable to identify user.');
      return;
    }

    try {
      // Get recent CurlyJoe calls
      await ctx.reply('📊 **Loading recent CurlyJoe calls...**', { parse_mode: 'Markdown' });

      // Try to find CurlyJoe calls by checking different caller name variations
      let recentCalls: CallerAlert[] = [];
      
      for (const callerName of CURLYJOE_NAMES) {
        try {
          const calls = await callerDatabase.getCallerAlerts(callerName, 20);
          if (calls.length > 0) {
            recentCalls = calls;
            logger.info('Found CurlyJoe calls', { callerName, count: calls.length });
            break;
          }
        } catch (error) {
          // Try next variation
          continue;
        }
      }

      // If no calls found by name, try getting recent calls and filtering
      if (recentCalls.length === 0) {
        const allRecent = await callerDatabase.getCallerAlertsInRange(
          '', // All callers
          new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          new Date()
        );
        
        // Filter for CurlyJoe (case-insensitive)
        recentCalls = allRecent.filter(alert => 
          CURLYJOE_NAMES.some(name => 
            alert.callerName.toLowerCase().includes(name.toLowerCase())
          )
        ).slice(0, 20);
      }

      if (recentCalls.length === 0) {
        await ctx.reply(
          '❌ **No Recent CurlyJoe Calls Found**\n\n' +
          'No calls from CurlyJoe found in the database.\n\n' +
          'Make sure:\n' +
          '• CurlyJoe channel monitoring is set up\n' +
          '• Recent calls have been ingested\n' +
          '• Caller name matches: `curlyjoe`, `curly joe`, or `curly`',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Filter to only show calls with price data (required for monitoring)
      const callsWithPrice = recentCalls.filter(call => 
        call.priceAtAlert && call.priceAtAlert > 0
      );

      if (callsWithPrice.length === 0) {
        await ctx.reply(
          '❌ **No Valid Calls Found**\n\n' +
          'All recent CurlyJoe calls are missing price data.\n' +
          'Price data is required for live monitoring.',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Show calls in interactive menu (limit to 10 for UI)
      const callsToShow = callsWithPrice.slice(0, 10);
      
      let message = `📊 **Recent CurlyJoe Calls (${callsToShow.length} shown)**\n\n`;
      message += `Select calls to add to live monitoring:\n\n`;

      // Create inline keyboard buttons
      const buttons: any[] = [];
      
      callsToShow.forEach((call, index) => {
        const date = new Date(call.alertTimestamp).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        
        const symbol = call.tokenSymbol || call.tokenAddress.slice(0, 8);
        const price = call.priceAtAlert ? `$${call.priceAtAlert.toFixed(8)}` : 'N/A';
        
        message += `${index + 1}. **${symbol}** - ${date}\n`;
        message += `   Price: ${price} | \`${call.tokenAddress.slice(0, 8)}...\`\n\n`;

        // Create button for each call
        buttons.push([
          Markup.button.callback(
            `${index + 1}. ${symbol} - ${date}`,
            `add_curlyjoe:${call.tokenAddress}:${call.chain}`
          )
        ]);
      });

      // Add "Add All" button
      buttons.push([
        Markup.button.callback('✅ Add All to Monitoring', 'add_curlyjoe:all')
      ]);

      await ctx.reply(message, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });

      // Store calls in session for callback handling
      const sessionData: Session = {
        type: 'add_curlyjoe',
        step: 'selecting_calls',
        data: {
          curlyjoeCalls: callsToShow.map(call => ({
            tokenAddress: call.tokenAddress,
            tokenSymbol: call.tokenSymbol,
            chain: call.chain,
            alertTimestamp: call.alertTimestamp,
            priceAtAlert: call.priceAtAlert,
            volumeAtAlert: call.volumeAtAlert,
            callerName: call.callerName,
            id: call.id,
          })),
        },
      };

      // Store session so callback handler can access it
      sessionService.setSession(userId, sessionData);

    } catch (error) {
      logger.error('AddCurlyJoe command error', error as Error, { userId });
      await this.sendError(ctx, '❌ Error loading CurlyJoe calls. Please try again later.');
    }
  }

  /**
   * Handle callback query for adding a specific call
   */
  static async handleCallback(
    ctx: Context,
    data: string,
    session?: Session
  ): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.answerCbQuery('Unable to identify user.');
      return;
    }

    try {
      const [action, tokenAddress, chain] = data.split(':');

      if (action !== 'add_curlyjoe') {
        return;
      }

      // Get live trade service
      const liveTradeService = LiveTradeCommandHandler.getService();
      if (!liveTradeService || !liveTradeService.getStatus().isRunning) {
        await ctx.answerCbQuery('⚠️ Live monitoring service is not running. Use /livetrade start first.');
        await ctx.editMessageText(
          '❌ **Live Monitoring Not Running**\n\n' +
          'Please start the live monitoring service first:\n' +
          '`/livetrade start`',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      if (tokenAddress === 'all') {
        // Add all calls from session
        if (!session?.data?.curlyjoeCalls) {
          await ctx.answerCbQuery('❌ No calls found in session.');
          return;
        }

        const calls = session.data.curlyjoeCalls as any[];
        let addedCount = 0;
        let skippedCount = 0;

        await ctx.answerCbQuery('⏳ Adding calls to monitoring...');
        await ctx.editMessageText('⏳ **Fetching historical data...**\n\nThis may take a moment.');

        for (const call of calls) {
          try {
            // Create CallerAlert object
            const alert: CallerAlert = {
              id: call.id,
              callerName: call.callerName || 'curlyjoe',
              tokenAddress: call.tokenAddress,
              tokenSymbol: call.tokenSymbol,
              chain: call.chain || 'solana',
              alertTimestamp: new Date(call.alertTimestamp),
              priceAtAlert: call.priceAtAlert,
              volumeAtAlert: call.volumeAtAlert,
              createdAt: new Date(),
            };

            // Fetch historical candles (3 API calls: 1m, 5m, 1h)
            logger.info('Fetching historical candles for monitoring', {
              tokenAddress: alert.tokenAddress.substring(0, 20),
            });
            const historicalCandles = await fetchHistoricalCandlesForMonitoring(
              alert.tokenAddress,
              alert.chain,
              alert.alertTimestamp
            );

            // Add to monitoring service with historical candles
            await liveTradeService.addToken(alert, DEFAULT_MONITOR_CONFIG, historicalCandles);
            addedCount++;
          } catch (error) {
            logger.warn('Failed to add call to monitoring', { 
              error, 
              tokenAddress: call.tokenAddress 
            });
            skippedCount++;
          }
        }

        await ctx.editMessageText(
          `✅ **Added to Live Monitoring**\n\n` +
          `📊 **Results:**\n` +
          `• Added: ${addedCount}\n` +
          `• Skipped: ${skippedCount}\n\n` +
          `**Configuration:**\n` +
          `• Initial Entry: 10% price drop\n` +
          `• Trailing Entry: 5% rebound from low\n` +
          `• Ichimoku Signals: Enabled\n` +
          `• Monitoring via WebSocket\n\n` +
          `Use \`/livetrade status\` to check monitoring status.`,
          { parse_mode: 'Markdown' }
        );
      } else {
        // Add single call
        // Find the call in session data or fetch from database
        let alert: CallerAlert | null = null;

        if (session?.data?.curlyjoeCalls) {
          const calls = session.data.curlyjoeCalls as any[];
          const call = calls.find(c => c.tokenAddress === tokenAddress);
          if (call) {
            alert = {
              id: call.id,
              callerName: call.callerName || 'curlyjoe',
              tokenAddress: call.tokenAddress,
              tokenSymbol: call.tokenSymbol,
              chain: call.chain || chain || 'solana',
              alertTimestamp: new Date(call.alertTimestamp),
              priceAtAlert: call.priceAtAlert,
              volumeAtAlert: call.volumeAtAlert,
              createdAt: new Date(),
            };
          }
        }

        // If not in session, try to fetch from database
        if (!alert) {
          const calls = await callerDatabase.getCallerAlerts('curlyjoe', 50);
          const call = calls.find(c => c.tokenAddress === tokenAddress);
          if (call) {
            alert = call;
          }
        }

        if (!alert || !alert.priceAtAlert || alert.priceAtAlert <= 0) {
          await ctx.answerCbQuery('❌ Call not found or missing price data.');
          return;
        }

        await ctx.answerCbQuery('⏳ Fetching historical data...');
        await ctx.editMessageText('⏳ **Fetching historical candles...**\n\nMaking 3 API calls (1m, 5m, 1h)...');

        try {
          // Fetch historical candles (3 API calls: 1m, 5m, 1h)
          logger.info('Fetching historical candles for monitoring', {
            tokenAddress: alert.tokenAddress.substring(0, 20),
          });
          const historicalCandles = await fetchHistoricalCandlesForMonitoring(
            alert.tokenAddress,
            alert.chain,
            alert.alertTimestamp
          );

          // Add to monitoring service with historical candles
          await liveTradeService.addToken(alert, DEFAULT_MONITOR_CONFIG, historicalCandles);

          const symbol = alert.tokenSymbol || alert.tokenAddress.slice(0, 8);
          
          await ctx.editMessageText(
            `✅ **Added to Live Monitoring**\n\n` +
            `🪙 **Token:** ${symbol}\n` +
            `📍 **Address:** \`${alert.tokenAddress}\`\n` +
            `💰 **Alert Price:** $${alert.priceAtAlert.toFixed(8)}\n` +
            `🔗 **Chain:** ${alert.chain}\n\n` +
            `**Historical Data:**\n` +
            `• Fetched ${historicalCandles.length} historical candles\n` +
            `• Indicators calculated and ready\n\n` +
            `**Monitoring Configuration:**\n` +
            `• Initial Entry: 10% price drop\n` +
            `• Trailing Entry: 5% rebound from low\n` +
            `• Ichimoku Signals: Enabled\n` +
            `• WebSocket: Active\n\n` +
            `You'll receive alerts when entry conditions are met!`,
            { parse_mode: 'Markdown' }
          );
        } catch (error) {
          logger.error('Failed to add token to monitoring', error as Error, {
            tokenAddress: alert.tokenAddress,
          });
          await ctx.answerCbQuery('❌ Failed to add to monitoring. Check logs.');
        }
      }
    } catch (error) {
      logger.error('AddCurlyJoe callback error', error as Error, { userId });
      await ctx.answerCbQuery('❌ Error processing request.');
    }
  }
}

