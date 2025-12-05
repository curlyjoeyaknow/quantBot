/**
 * Options Command Handler
 * =======================
 * Handles the /options command for displaying all available commands and their descriptions.
 */

import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';

export class OptionsCommandHandler extends BaseCommandHandler {
  readonly command = 'options';
  
  async execute(ctx: Context, session?: Session): Promise<void> {
    const helpMessage = `📚 **QuantBot Commands**

**🎯 Core Simulation Commands:**
• \`/backtest\` - Start a new PNL simulation
• \`/repeat\` - Repeat a previous simulation with new strategy
• \`/strategy\` - Manage custom trading strategies
  - \`/strategy\` - List all strategies
  - \`/strategy save <name> <desc> <strategy> <stop_loss>\` - Save strategy
  - \`/strategy use <name>\` - Load strategy for next backtest
  - \`/strategy delete <name>\` - Delete a strategy
• \`/cancel\` - Cancel current simulation session

**📊 Analysis & Data Commands:**
• \`/analysis\` - Run comprehensive historical analysis on all CA drops
• \`/extract\` - Extract CA drops from HTML chat messages
• \`/history\` - View simulation history
• \`/calls <token_address>\` - Show all historical calls for a token
• \`/callers\` - Show top callers statistics
• \`/recent\` - Show recent CA calls (last 15)
• \`/backtest_call\` - Backtest a specific call from database

**📈 Technical Analysis:**
• \`/ichimoku\` - Start Ichimoku Cloud analysis for a token

**🔔 Alert Commands:**
• \`/alert\` - Check specific alert status
• \`/alerts\` - View active alerts and monitoring status

**⚙️ Utility Commands:**
• \`/begin\` - Show welcome message
• \`/options\` - Show this command menu

**💡 Automatic Features:**
The bot automatically detects CA drops in chat messages containing token addresses and keywords like "ca", "contract", "address", "buy", "pump", "moon", "gem", "call".

**🌐 Supported Chains:**
Solana, Ethereum, BSC, Base, Arbitrum

**📖 Examples:**
\`/backtest\` - Start a simulation
\`/calls So11111111111111111111111111111111111111112\` - View calls for a token
\`/strategy save moonshot Moonshot strategy 10@3x,10@5x,80@10x initial: -25%, trailing: 30%\` - Save a strategy`;

    await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
  }
}

