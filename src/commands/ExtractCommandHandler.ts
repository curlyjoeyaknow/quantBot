/**
 * Extract Command Handler
 * =======================
 * Handles the /extract command for extracting CA drops from messages
 */

import { Context } from 'telegraf';
import { BaseCommandHandler } from './interfaces/CommandHandler';
import { Session } from './interfaces/CommandHandler';

export class ExtractCommandHandler extends BaseCommandHandler {
  readonly command = 'extract';

  async execute(ctx: Context, session?: Session): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply('❌ Unable to identify user');
      return;
    }

    try {
      await ctx.reply('📥 **Extracting CA Drops from Messages...**\n\nProcessing HTML files in the messages folder...');
      
      // Run the extraction script
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      const { stdout, stderr } = await execAsync('node extract_ca_drops_v2.js');
      
      if (stderr) {
        console.error('Extraction stderr:', stderr);
      }
      
      // Parse the output to get extraction results
      const lines = stdout.split('\n');
      const extractedCount = lines.find((line: string) => line.includes('Extracted'))?.match(/(\d+)/)?.[1] || '0';
      const savedCount = lines.find((line: string) => line.includes('Saved'))?.match(/(\d+)/)?.[1] || '0';
      
      await ctx.reply(`✅ **Extraction Complete!**\n\n📊 **Results:**\n• Extracted: ${extractedCount} CA drops\n• Saved to database: ${savedCount}\n\nUse \`/analysis\` to run historical analysis on the extracted data.`);
      
    } catch (error) {
      console.error('Extraction command error:', error);
      await ctx.reply('❌ **Extraction Failed**\n\nAn error occurred during CA extraction. Make sure the messages folder exists and contains HTML files.');
    }
  }
}