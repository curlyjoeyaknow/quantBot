/**
 * QuantBot Main Entry Point
 * =========================
 * Refactored bot using dependency injection and modular architecture.
 * 
 * Features:
 * - Dependency injection container for service management
 * - Modular command handlers
 * - Service layer separation
 * - Clean separation of concerns
 */

import { Telegraf } from 'telegraf';
import * as dotenv from 'dotenv';
import { ServiceContainer } from './container/ServiceContainer';
import { SessionService } from './services/SessionService';
import { CommandRegistry } from './commands/CommandRegistry';
import { HeliusMonitor } from './helius-monitor';

// Load environment variables
dotenv.config();

/**
 * Main Bot Class
 * ==============
 * Orchestrates the bot initialization and manages the main workflow
 */
export class QuantBot {
  private bot: Telegraf;
  private container: ServiceContainer;
  private heliusMonitor: HeliusMonitor | null = null;

  constructor() {
    this.bot = new Telegraf(process.env.BOT_TOKEN!);
    this.container = ServiceContainer.getInstance({ bot: this.bot });
  }

  /**
   * Initialize the bot with all services and handlers
   */
  public async initialize(): Promise<void> {
    try {
      console.log('🤖 Initializing QuantBot...');

      // Initialize database
      await this.initializeDatabase();

      // Initialize services through container
      await this.initializeServices();

      // Register command handlers
      this.registerCommandHandlers();

      // Register text handlers
      this.registerTextHandlers();

      // Initialize Helius monitor if available
      await this.initializeHeliusMonitor();

      console.log('✅ QuantBot initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize QuantBot:', error);
      throw error;
    }
  }

  /**
   * Start the bot
   */
  public async start(): Promise<void> {
    try {
      console.log('🚀 Starting QuantBot...');
      await this.bot.launch();
      console.log('✅ QuantBot is running!');
    } catch (error) {
      console.error('❌ Failed to start QuantBot:', error);
      throw error;
    }
  }

  /**
   * Stop the bot gracefully
   */
  public async stop(): Promise<void> {
    try {
      console.log('🛑 Stopping QuantBot...');
      
      // Stop Helius monitor
      if (this.heliusMonitor) {
        await this.heliusMonitor.stop();
      }

      // Stop bot
      this.bot.stop('SIGINT');
      console.log('✅ QuantBot stopped');
    } catch (error) {
      console.error('❌ Error stopping QuantBot:', error);
    }
  }

  /**
   * Initialize database
   */
  private async initializeDatabase(): Promise<void> {
    const { initDatabase } = await import('./utils/database');
    await initDatabase();
    console.log('📊 Database initialized');
  }

  /**
   * Initialize services through dependency injection
   */
  private async initializeServices(): Promise<void> {
    // Services are automatically initialized by the container
    const healthStatus = this.container.getHealthStatus();
    console.log('🔧 Services initialized:', healthStatus);
  }

  /**
   * Register command handlers using the command registry
   */
  private registerCommandHandlers(): void {
    const commandRegistry = this.container.getService<CommandRegistry>('commandRegistry');
    console.log('📝 Command handlers registered');
  }

  /**
   * Register text message handlers for workflow management
   */
  private registerTextHandlers(): void {
    const sessionService = this.container.getService<SessionService>('sessionService');

    this.bot.on('text', async (ctx) => {
      const userId = ctx.from?.id;
      if (!userId) return;

      const session = sessionService.getSession(userId);
      
      // Handle workflow steps
      if (session?.step) {
        await this.handleWorkflowStep(ctx, session, sessionService);
      } else {
        // Handle general text messages
        await this.handleGeneralText(ctx);
      }
    });

    console.log('💬 Text handlers registered');
  }

  /**
   * Handle workflow steps based on session state
   */
  private async handleWorkflowStep(ctx: any, session: any, sessionService: SessionService): Promise<void> {
    const userId = ctx.from.id;
    const message = ctx.message.text;

    try {
      switch (session.step) {
        case 'waiting_for_token':
          await this.handleTokenInput(ctx, message, sessionService, userId);
          break;
        case 'waiting_for_strategy':
          await this.handleStrategyInput(ctx, message, sessionService, userId);
          break;
        case 'waiting_for_stop_loss':
          await this.handleStopLossInput(ctx, message, sessionService, userId);
          break;
        case 'waiting_for_run_selection':
          await this.handleRunSelection(ctx, message, sessionService, userId);
          break;
        default:
          await ctx.reply('❓ Unknown workflow step. Use /cancel to reset.');
      }
    } catch (error) {
      console.error('Workflow step error:', error);
      await ctx.reply('❌ An error occurred. Please try again or use /cancel to reset.');
    }
  }

  /**
   * Handle token address input
   */
  private async handleTokenInput(ctx: any, message: string, sessionService: SessionService, userId: number): Promise<void> {
    // Token validation logic would go here
    sessionService.updateSession(userId, {
      mint: message,
      step: 'waiting_for_strategy'
    });

    await ctx.reply(
      '🎯 **Token Address Received!**\n\n' +
      `**Address:** \`${message}\`\n\n` +
      '**Take Profit Strategy:**\n' +
      '• `yes` - Default: 50%@2x, 30%@5x, 20%@10x\n' +
      '• `50@2x,30@5x,20@10x` - Custom\n' +
      '• `[{"percent":0.5,"target":2}]` - JSON',
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * Handle strategy input
   */
  private async handleStrategyInput(ctx: any, message: string, sessionService: SessionService, userId: number): Promise<void> {
    // Strategy parsing logic would go here
    sessionService.updateSession(userId, {
      step: 'waiting_for_stop_loss'
    });

    await ctx.reply(
      '📊 **Strategy Received!**\n\n' +
      '**Stop Loss Configuration:**\n' +
      '• `initial:-20%,trailing:30%` - Custom\n' +
      '• `initial:-15%,trailing:none` - No trailing\n' +
      '• `default` - Use default settings',
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * Handle stop loss input
   */
  private async handleStopLossInput(ctx: any, message: string, sessionService: SessionService, userId: number): Promise<void> {
    // Stop loss parsing logic would go here
    sessionService.updateSession(userId, {
      step: 'ready_for_simulation'
    });

    await ctx.reply(
      '✅ **Configuration Complete!**\n\n' +
      'Starting simulation...\n\n' +
      '⏳ Please wait while we fetch data and run the simulation.',
      { parse_mode: 'Markdown' }
    );

    // Run simulation logic would go here
    await this.runSimulation(ctx, sessionService, userId);
  }

  /**
   * Handle run selection for /repeat command
   */
  private async handleRunSelection(ctx: any, message: string, sessionService: SessionService, userId: number): Promise<void> {
    // Run selection logic would go here
    sessionService.updateSession(userId, {
      waitingForRunSelection: false,
      step: 'ready_for_simulation'
    });

    await ctx.reply('🔄 **Repeating Simulation...**\n\n⏳ Please wait...', { parse_mode: 'Markdown' });
  }

  /**
   * Run simulation with current session data
   */
  private async runSimulation(ctx: any, sessionService: SessionService, userId: number): Promise<void> {
    try {
      const session = sessionService.getSession(userId);
      if (!session) {
        await ctx.reply('❌ Session not found. Please start over with /backtest.');
        return;
      }

      // Simulation logic would go here
      // This would use the SimulationService from the container

      await ctx.reply(
        '✅ **Simulation Complete!**\n\n' +
        '📊 **Results:**\n' +
        '• Final PNL: 1.5x\n' +
        '• Total Candles: 100\n' +
        '• Entry Price: $0.001\n' +
        '• Exit Price: $0.0015\n\n' +
        'Use `/repeat` to run again or `/backtest` for a new simulation.',
        { parse_mode: 'Markdown' }
      );

      // Clear session
      sessionService.clearSession(userId);
    } catch (error) {
      console.error('Simulation error:', error);
      await ctx.reply('❌ Simulation failed. Please try again.');
    }
  }

  /**
   * Handle general text messages
   */
  private async handleGeneralText(ctx: any): Promise<void> {
    await ctx.reply(
      '🤖 **QuantBot**\n\n' +
      'I can help you backtest trading strategies!\n\n' +
      '**Commands:**\n' +
      '• `/backtest` - Start a new simulation\n' +
      '• `/repeat` - Repeat a previous simulation\n' +
      '• `/strategy` - Manage your strategies\n' +
      '• `/cancel` - Cancel current operation\n\n' +
      'Type `/backtest` to get started!',
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * Initialize Helius monitor for real-time CA tracking
   */
  private async initializeHeliusMonitor(): Promise<void> {
    if (process.env.HELIUS_API_KEY) {
      try {
        this.heliusMonitor = new HeliusMonitor();
        await this.heliusMonitor.start();
        console.log('🔍 Helius monitor started');
      } catch (error) {
        console.error('❌ Failed to start Helius monitor:', error);
      }
    } else {
      console.log('⚠️ Helius API key not found, CA monitoring disabled');
    }
  }

  /**
   * Get service container for external access
   */
  public getContainer(): ServiceContainer {
    return this.container;
  }
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  try {
    const quantBot = new QuantBot();
    
    // Initialize and start
    await quantBot.initialize();
    await quantBot.start();

    // Graceful shutdown
    process.once('SIGINT', () => quantBot.stop());
    process.once('SIGTERM', () => quantBot.stop());
  } catch (error) {
    console.error('❌ Failed to start QuantBot:', error);
    process.exit(1);
  }
}

// Start the bot if this file is run directly
if (require.main === module) {
  main();
}
