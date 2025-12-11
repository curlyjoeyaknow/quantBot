/**
 * QuantBot Main Logic
 * ===================
 * Core logic for QuantBot Telegram bot, enabling backtesting of token strategies and real-time contract address (CA) drop monitoring.
 *
 * Features:
 * - Interactive, stateful chat workflow for simulating and optimizing token trading strategies.
 * - Supports multiple blockchains: Solana, Ethereum, BSC, and Base.
 * - Manages custom strategies (save, use, delete).
 * - Detects and monitors contract drops, automating token tracking.
 *
 * Code Structure:
 *  1. Imports & Initialization
 *  2. Core Constants & Types
 *  3. Command Handlers (/backtest, /repeat, /broadcast, /cancel, /strategy)
 *  4. Main Stateful Text Handler (workflow engine)
 *  5. CA Drop Detection & Processing
 *  6. Bot Startup/Shutdown
 *
 * Design Principles:
 * - Consistent, readable comments.
 * - Maintainability via clear typing & session schema.
 * - Ready for upgrades: settings per session, new chains, strategy types.
 */
export {};
//# sourceMappingURL=bot.d.ts.map