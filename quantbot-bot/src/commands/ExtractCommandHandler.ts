/**
 * Extract Command Handler
 * ======================
 * Handles the /extract command for extracting CA drops from chat messages
 * and saving them to the database.
 */

import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

export class ExtractCommandHandler extends BaseCommandHandler {
  readonly command = 'extract';
  
  async execute(ctx: Context, session?: Session): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await this.sendError(ctx, 'Unable to identify user.');
      return;
    }
    
    try {
      await ctx.reply('📥 **Extracting CA Drops from Messages...**\n\nProcessing HTML files in the messages folder...');
      
      // Run the extraction script
      const { stdout, stderr } = await execAsync('node extract_ca_drops_v2.js');
      
      if (stderr) {
        logger.warn('Extraction stderr', { stderr, userId });
      }
      
      // Parse the output to get extraction results
      const lines = stdout.split('\n');
      const extractedCount = lines.find((line: string) => line.includes('Extracted'))?.match(/(\d+)/)?.[1] || '0';
      const savedCount = lines.find((line: string) => line.includes('Saved'))?.match(/(\d+)/)?.[1] || '0';
      
      await ctx.reply(
        `✅ **Extraction Complete!**\n\n` +
        `📊 **Results:**\n` +
        `• Extracted: ${extractedCount} CA drops\n` +
        `• Saved to database: ${savedCount}\n\n` +
        `Use \`/analysis\` to run historical analysis on the extracted data.`,
        { parse_mode: 'Markdown' }
      );
      
    } catch (error) {
      logger.error('Extraction command error', error as Error, { userId });
      await this.sendError(ctx, 
        '❌ **Extraction Failed**\n\n' +
        'An error occurred during CA extraction. Make sure the messages folder exists and contains HTML files.'
      );
    }
  }
}
