/**
 * Analysis Command Handler
 * ========================
 * Handles the /analysis command for running historical analysis
 */

import { Context } from 'telegraf';
import { BaseCommandHandler } from './interfaces/CommandHandler';
import { Session } from './interfaces/CommandHandler';

export class AnalysisCommandHandler extends BaseCommandHandler {
  readonly command = 'analysis';

  async execute(ctx: Context, session?: Session): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply('❌ Unable to identify user');
      return;
    }

    try {
      await ctx.reply('🔍 **Starting Historical Analysis...**\n\nThis may take a few minutes while fetching current prices for all tracked CAs...');
      
      // Import and run the analysis
      const { HistoricalAnalyzer } = require('../historical_analysis');
      const analyzer = new HistoricalAnalyzer();
      
      await analyzer.init();
      const analysis = await analyzer.runAnalysis();
      await analyzer.close();
      
      // Send the formatted report
      const report = analyzer.formatAnalysisResults(analysis);
      
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
        
        if (currentPart.trim()) {
          parts.push(currentPart);
        }
        
        // Send each part
        for (let i = 0; i < parts.length; i++) {
          const partNumber = parts.length > 1 ? ` (${i + 1}/${parts.length})` : '';
          await ctx.reply(`📊 **Analysis Report${partNumber}:**\n\n${parts[i]}`);
          
          // Add delay between messages to avoid rate limiting
          if (i < parts.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      } else {
        await ctx.reply(`📊 **Analysis Report:**\n\n${report}`);
      }
      
    } catch (error) {
      console.error('Analysis command error:', error);
      await ctx.reply('❌ **Analysis Failed**\n\nAn error occurred during historical analysis. Check the logs for details.');
    }
  }
}