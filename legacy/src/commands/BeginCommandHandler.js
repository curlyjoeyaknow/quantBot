"use strict";
/**
 * Begin Command Handler
 * =====================
 * Handles the /begin command for welcoming new users and showing available commands.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BeginCommandHandler = void 0;
const CommandHandler_1 = require("./interfaces/CommandHandler");
class BeginCommandHandler extends CommandHandler_1.BaseCommandHandler {
    constructor() {
        super(...arguments);
        this.command = 'begin';
    }
    async execute(ctx, session) {
        const welcomeMessage = `🤖 **Welcome to QuantBot!**

I'm your advanced trading simulation and CA monitoring assistant.

**📊 Core Features:**
• Backtest trading strategies on historical data
• Monitor contract addresses (CA) in real-time
• Analyze caller performance and token history
• Ichimoku Cloud technical analysis
• Multi-chain support (Solana, Ethereum, BSC, Base, Arbitrum)

**🚀 Quick Start:**
Use \`/backtest\` to simulate a trading strategy on any token.

**📱 Available Commands:**
Use \`/options\` to see all available commands.

**💡 Tip:** Just paste a token address to start tracking it automatically!`;
        await ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });
    }
}
exports.BeginCommandHandler = BeginCommandHandler;
//# sourceMappingURL=BeginCommandHandler.js.map