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
 *  2. ServiceContainer Setup
 *  3. CommandRegistry Setup
 *  4. Text Workflow Registration
 *  5. Bot Startup & Shutdown
 *
 * Design Principles:
 * - Consistent, readable comments.
 * - Maintainability via clear typing & session schema.
 * - Ready for upgrades: settings per session, new chains, strategy types.
 */
import { Telegraf } from 'telegraf';
import { ServiceContainer } from './container/ServiceContainer';
import { CommandRegistry } from './commands/CommandRegistry';
declare const bot: Telegraf<import("telegraf").Context<import("telegraf/types").Update>>;
declare const serviceContainer: ServiceContainer;
declare const commandRegistry: CommandRegistry;
export { bot, serviceContainer, commandRegistry };
//# sourceMappingURL=bot.d.ts.map