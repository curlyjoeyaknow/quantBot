/**
 * Alerts Command Handler
 * ======================
 * Handles the /alerts command for displaying all tracked tokens and
 * configured alerts in a paginated table format.
 */

import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { SessionService } from '../services/SessionService';
import { getActiveCATracking, getAllCACalls } from '../utils/database';
import { logger } from '../utils/logger';

export class AlertsCommandHandler extends BaseCommandHandler {
  readonly command = 'alerts';
  
  constructor(private sessionService: SessionService) {
    super();
  }
  
  async execute(ctx: Context, session?: Session): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await this.sendError(ctx, 'Unable to identify user.');
      return;
    }
    
    logger.debug('/alerts command triggered', { userId });
    
    try {
      // Clear any existing session to prevent conflicts
      this.sessionService.clearSession(userId);
      
      // Get active CA tracking entries
      const activeCAs = await getActiveCATracking();
      
      // Get recent historical CA calls (last 20)
      const recentCalls = await getAllCACalls(20);
      
      if (activeCAs.length === 0 && recentCalls.length === 0) {
        await ctx.reply(
          '📊 **No Active Alerts Found**\n\n' +
          'No tokens are currently being tracked and no recent CA calls found.\n\n' +
          'Use `/ichimoku` to start monitoring a token or drop a CA address to begin tracking.',
          { parse_mode: 'Markdown' }
        );
        return;
      }
      
      // Combine and format the data
      let alertsMessage = `📊 **Active Alerts & Tracked Tokens**\n\n`;
      
      // Active CA Tracking Section
      if (activeCAs.length > 0) {
        alertsMessage += `🟢 **Active Tracking (${activeCAs.length})**\n`;
        alertsMessage += `┌─────────────────────────────────────────────────────────────┐\n`;
        alertsMessage += `│ Token Name           │ Chain    │ Price      │ Status        │\n`;
        alertsMessage += `├─────────────────────────────────────────────────────────────┤\n`;
        
        // Show only first 10 active CAs to avoid message length issues
        const activeCAsToShow = activeCAs.slice(0, 10);
        
        for (const ca of activeCAsToShow) {
          const chainEmoji = ca.chain === 'solana' ? '🟣' : 
                            ca.chain === 'ethereum' ? '🔵' : 
                            ca.chain === 'bsc' ? '🟡' : '⚪';
          const tokenName = (ca.token_name || 'Unknown').substring(0, 18).padEnd(18);
          const chain = ca.chain.toUpperCase().substring(0, 7).padEnd(7);
          const price = `$${(ca.call_price || 0).toFixed(6)}`.padEnd(10);
          const status = ca.lastPrice ? '🟢 Live' : '⏳ Pending';
          
          alertsMessage += `│ ${tokenName} │ ${chain} │ ${price} │ ${status.padEnd(12)} │\n`;
        }
        
        alertsMessage += `└─────────────────────────────────────────────────────────────┘\n\n`;
        
        if (activeCAs.length > 10) {
          alertsMessage += `... and ${activeCAs.length - 10} more active trackings\n\n`;
        }
      }
      
      // Recent CA Calls Section
      if (recentCalls.length > 0) {
        alertsMessage += `📈 **Recent CA Calls (${recentCalls.length})**\n`;
        alertsMessage += `┌─────────────────────────────────────────────────────────────┐\n`;
        alertsMessage += `│ Token Name           │ Chain    │ Price      │ Time          │\n`;
        alertsMessage += `├─────────────────────────────────────────────────────────────┤\n`;
        
        // Show only first 10 recent calls
        const recentCallsToShow = recentCalls.slice(0, 10);
        
        for (const call of recentCallsToShow) {
          const chainEmoji = call.chain === 'solana' ? '🟣' : 
                            call.chain === 'ethereum' ? '🔵' : 
                            call.chain === 'bsc' ? '🟡' : '⚪';
          const tokenName = (call.token_name || 'Unknown').substring(0, 18).padEnd(18);
          const chain = call.chain.toUpperCase().substring(0, 7).padEnd(7);
          const price = `$${(call.call_price || 0).toFixed(6)}`.padEnd(10);
          const time = call.call_timestamp ? 
            new Date(call.call_timestamp * 1000).toLocaleString().substring(0, 12).padEnd(12) : 
            'Unknown'.padEnd(12);
          
          alertsMessage += `│ ${tokenName} │ ${chain} │ ${price} │ ${time} │\n`;
        }
        
        alertsMessage += `└─────────────────────────────────────────────────────────────┘\n\n`;
        
        if (recentCalls.length > 10) {
          alertsMessage += `... and ${recentCalls.length - 10} more recent calls\n\n`;
        }
      }
      
      // Summary section
      const totalActive = activeCAs.length;
      const totalRecent = recentCalls.length;
      const chains = [...new Set([...activeCAs.map((ca: any) => ca.chain), ...recentCalls.map((call: any) => call.chain)])];
      
      alertsMessage += `📊 **Summary:**\n`;
      alertsMessage += `• Active Trackings: ${totalActive}\n`;
      alertsMessage += `• Recent Calls: ${totalRecent}\n`;
      alertsMessage += `• Chains: ${chains.join(', ')}\n\n`;
      
      alertsMessage += `💡 **Commands:**\n`;
      alertsMessage += `• \`/ichimoku\` - Start Ichimoku monitoring\n`;
      alertsMessage += `• \`/history\` - View all historical calls\n`;
      alertsMessage += `• Drop a CA address to auto-track`;
      
      // Send the message
      await ctx.reply(alertsMessage, { parse_mode: 'Markdown' });
      
    } catch (error) {
      logger.error('Alerts command error', error as Error, { userId });
      await this.sendError(ctx, '❌ Error retrieving alerts data. Please try again later.');
    }
  }
}
