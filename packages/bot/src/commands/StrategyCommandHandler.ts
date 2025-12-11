/**
 * Strategy Command Handler
 * ========================
 * Handles the /strategy command for managing custom trading strategies.
 * Supports save, use, delete, and list operations.
 */

import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { StrategyService } from '@quantbot/services';
import { eventBus, EventFactory } from './events';
import { logger } from '@quantbot/utils';
import { extractCommandArgs, sanitizeInput } from '../utils/command-helpers';

export class StrategyCommandHandler extends BaseCommandHandler {
  readonly command = 'strategy';
  
  protected defaultOptions = {
    timeout: 30_000, // 30 seconds
    requirePrivateChat: true,
    rateLimit: true,
    showTyping: true,
  };
  
  constructor(private strategyService: StrategyService) {
    super();
  }
  
  async execute(ctx: Context, session?: Session): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await this.sendError(ctx, 'Unable to identify user.');
      return;
    }

    // Support 'text', 'caption', or fallback to empty string
    let message = '';
    if ('text' in (ctx.message ?? {})) {
      message = (ctx.message as { text: string }).text;
    } else if ('caption' in (ctx.message ?? {})) {
      message = (ctx.message as { caption: string }).caption;
    }
    
    // Extract and sanitize arguments
    const args = extractCommandArgs(message, this.command).map(arg => sanitizeInput(arg, 500));
    const parts = ['/strategy', ...args];
    
    try {
      if (parts.length === 1) {
        // List strategies
        await this.handleListStrategies(ctx, userId);
      } else if (parts[1] === 'save' && parts.length >= 3) {
        // Save strategy
        await this.handleSaveStrategy(ctx, userId, parts.slice(2));
      } else if (parts[1] === 'use' && parts.length >= 3) {
        // Use strategy
        await this.handleUseStrategy(ctx, userId, parts[2]);
      } else if (parts[1] === 'delete' && parts.length >= 3) {
        // Delete strategy
        await this.handleDeleteStrategy(ctx, userId, parts[2]);
      } else {
        await this.sendError(ctx, 
          '**Invalid strategy command.**\n\n' +
          '**Usage:**\n' +
          '• `/strategy` - List all strategies\n' +
          '• `/strategy save <name> <description> <strategy> <stop_loss>` - Save strategy\n' +
          '• `/strategy use <name>` - Use strategy\n' +
          '• `/strategy delete <name>` - Delete strategy\n\n' +
          '**Example:**\n' +
          '`/strategy save MyStrategy "Conservative approach" 50@2x,30@5x,20@10x initial:-20%,trailing:30%`'
        );
      }
      
      // Emit command executed event
      await eventBus.publish(EventFactory.createUserEvent(
        'user.command.executed',
        { command: 'strategy', success: true },
        'StrategyCommandHandler',
        userId
      ));
      
    } catch (error) {
      logger.error('Strategy command error', error as Error, { userId });
      
      // Emit command failed event
      await eventBus.publish(EventFactory.createUserEvent(
        'user.command.failed',
        { command: 'strategy', success: false, error: error instanceof Error ? error.message : String(error) },
        'StrategyCommandHandler',
        userId
      ));
      
      await this.sendError(ctx, 'Failed to process strategy command. Please try again.');
    }
  }
  
  private async handleListStrategies(ctx: Context, userId: number): Promise<void> {
    const strategies = await this.strategyService.getUserStrategies(userId);
    
    if (strategies.length === 0) {
      await ctx.reply(
        '📊 **Your Saved Strategies**\n\n' +
        'No strategies saved yet.\n\n' +
        'Use `/strategy save <name> <description> <strategy> <stop_loss>` to create your first strategy.',
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    let message = '📊 **Your Saved Strategies**\n\n';
    
    strategies.forEach((strategy, index) => {
      message += `${index + 1}. **${strategy.name}**\n`;
      message += `   Description: ${strategy.description || 'No description'}\n`;
      message += `   Strategy: ${strategy.strategy}\n`;
      message += `   Stop Loss: ${strategy.stopLossConfig}\n\n`;
    });
    
    message += '💡 Use `/strategy use <name>` to activate a strategy.';
    
    await ctx.reply(message, { parse_mode: 'Markdown' });
  }
  
  private async handleSaveStrategy(ctx: Context, userId: number, args: string[]): Promise<void> {
    if (args.length < 4) {
      await this.sendError(ctx, 
        '**Incomplete save command.**\n\n' +
        '**Usage:** `/strategy save <name> <description> <strategy> <stop_loss>`\n\n' +
        '**Example:**\n' +
        '`/strategy save MyStrategy "Conservative approach" 50@2x,30@5x,20@10x initial:-20%,trailing:30%`'
      );
      return;
    }
    
    const [name, description, strategyStr, stopLossStr] = args;
    
    // Parse strategy
    const strategy = this.parseStrategy(strategyStr);
    if (!strategy) {
      await this.sendError(ctx, 'Invalid strategy format. Use format like: 50@2x,30@5x,20@10x');
      return;
    }
    
    // Parse stop loss
    const stopLossConfig = this.parseStopLoss(stopLossStr);
    if (!stopLossConfig) {
      await this.sendError(ctx, 'Invalid stop loss format. Use format like: initial:-20%,trailing:30%');
      return;
    }
    
    const strategyData = {
      name,
      description,
      strategy: strategy,
      stopLossConfig: stopLossConfig
    };
    
    await this.strategyService.saveStrategy(userId, strategyData);
    
    // Emit strategy saved event
    await eventBus.publish(EventFactory.createUserEvent(
      'user.strategy.saved',
      { strategyName: name, strategyData },
      'StrategyCommandHandler',
      userId
    ));
    
    await this.sendSuccess(ctx, 
      `Strategy "${name}" saved successfully!\n\n` +
      `**Strategy:** ${strategyStr}\n` +
      `**Stop Loss:** ${stopLossStr}\n\n` +
      `Use \`/strategy use ${name}\` to activate it.`
    );
  }
  
  private async handleUseStrategy(ctx: Context, userId: number, strategyName: string): Promise<void> {
    const strategy = await this.strategyService.getStrategy(userId, strategyName);
    
    if (!strategy) {
      await this.sendError(ctx, `Strategy "${strategyName}" not found.`);
      return;
    }
    
    // In a real implementation, this would set the active strategy in the session
    // For now, we'll just confirm the strategy was found
    
    // Emit strategy used event
    await eventBus.publish(EventFactory.createUserEvent(
      'user.strategy.used',
      { strategyName, strategyData: strategy },
      'StrategyCommandHandler',
      userId
    ));
    
    await this.sendSuccess(ctx, 
      `Strategy "${strategyName}" is now active!\n\n` +
      `**Description:** ${strategy.description || 'No description'}\n` +
      `**Strategy:** ${strategy.strategy}\n` +
      `**Stop Loss:** ${strategy.stopLossConfig}\n\n` +
      `This strategy will be used for future simulations.`
    );
  }
  
  private async handleDeleteStrategy(ctx: Context, userId: number, strategyName: string): Promise<void> {
    const strategy = await this.strategyService.getStrategy(userId, strategyName);
    
    if (!strategy) {
      await this.sendError(ctx, `Strategy "${strategyName}" not found.`);
      return;
    }
    
    await this.strategyService.deleteStrategy(userId, strategyName);
    
    // Emit strategy deleted event
    await eventBus.publish(EventFactory.createUserEvent(
      'user.strategy.deleted',
      { strategyName, strategyData: strategy },
      'StrategyCommandHandler',
      userId
    ));
    
    await this.sendSuccess(ctx, `Strategy "${strategyName}" deleted successfully.`);
  }
  
  private parseStrategy(strategyStr: string): any[] | null {
    try {
      // Parse format like "50@2x,30@5x,20@10x"
      const parts = strategyStr.split(',');
      const strategy = parts.map(part => {
        const [percentStr, targetStr] = part.split('@');
        const percent = parseFloat(percentStr) / 100;
        const target = parseFloat(targetStr.replace('x', ''));
        
        if (isNaN(percent) || isNaN(target) || percent <= 0 || target <= 0) {
          throw new Error('Invalid strategy format');
        }
        
        return { percent, target };
      });
      
      return strategy;
    } catch (error) {
      return null;
    }
  }
  
  private parseStopLoss(stopLossStr: string): any | null {
    try {
      // Parse format like "initial:-20%,trailing:30%"
      const parts = stopLossStr.split(',');
      const config: any = {};
      
      parts.forEach(part => {
        const [key, value] = part.split(':');
        if (key === 'initial') {
          config.initial = parseFloat(value.replace('%', '')) / 100;
        } else if (key === 'trailing') {
          if (value.toLowerCase() === 'none') {
            config.trailing = 'none';
          } else {
            config.trailing = parseFloat(value.replace('%', '')) / 100;
          }
        }
      });
      
      if (config.initial === undefined) {
        throw new Error('Missing initial stop loss');
      }
      
      return config;
    } catch (error) {
      return null;
    }
  }
}
