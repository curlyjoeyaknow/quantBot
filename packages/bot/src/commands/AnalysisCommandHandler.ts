/**
 * Analysis Command Handler
 * ========================
 * Handles the /analysis command for running historical analysis on CA drops
 * and formatting/sending the results.
 */

import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { logger } from '@quantbot/utils';
import { COMMAND_TIMEOUTS } from '../utils/command-helpers';

export class AnalysisCommandHandler extends BaseCommandHandler {
  readonly command = 'analysis';
  
  protected defaultOptions = {
    timeout: COMMAND_TIMEOUTS.ANALYSIS, // 5 minutes for analysis
    requirePrivateChat: true,
    rateLimit: true,
    showTyping: true,
  };
  
  async execute(ctx: Context, session?: Session): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await this.sendError(ctx, 'Unable to identify user.');
      return;
    }
    
    try {
      const progress = this.createProgressMessage(ctx);
      await progress.send('🔍 **Starting Historical Analysis...**\n\nThis may take a few minutes while fetching current prices for all tracked CAs...');
      
      // Import and run the analysis
      const { HistoricalAnalyzer } = require('../historical_analysis');
      const analyzer = new HistoricalAnalyzer();
      
      await progress.update('🔍 **Initializing analyzer...**');
      await analyzer.init();
      
      await progress.update('🔍 **Running analysis...**\n\nThis may take several minutes...');
      const analysis = await analyzer.runAnalysis();
      await analyzer.close();
      
      await progress.update('📊 **Formatting results...**');
      
      // Send the formatted report
      const report = analyzer.formatAnalysisResults(analysis);
      
      await progress.delete();
      
      // Split long messages if needed
      const maxLength = 4000;
      if (report.length > maxLength) {
        const parts = [] as string[];
        let currentPart = '';
        const lines = report.split('\n');
        
        for (const line of lines) {
          if (currentPart.length + line.length > maxLength) {
            parts.push(currentPart);
            currentPart = line + '\n';
          } else {
            currentPart += line + '\n';
          }
        }
        if (currentPart) parts.push(currentPart);
        
        for (let i = 0; i < parts.length; i++) {
          await ctx.reply(parts[i], { parse_mode: 'Markdown' });
          if (i < parts.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Delay between messages
          }
        }
      } else {
        await ctx.reply(report, { parse_mode: 'Markdown' });
      }
      
    } catch (error) {
      logger.error('Analysis command error', error as Error, { userId });
      await this.sendError(ctx, 
        '❌ **Analysis Failed**\n\n' +
        'An error occurred during the historical analysis. Please try again later.'
      );
    }
  }
}
