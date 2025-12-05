/**
 * Wallet Command Handler
 * 
 * Handles wallet management commands: /wallet add, list, balance, remove
 */

import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { WalletService, WalletManager } from '@quantbot/trading';
import { logger } from '@quantbot/utils';
import { extractCommandArgs } from '../utils/command-helpers';

export class WalletCommandHandler extends BaseCommandHandler {
  readonly command = 'wallet';

  protected defaultOptions = {
    timeout: 10_000,
    requirePrivateChat: true,
    rateLimit: true,
    showTyping: true,
  };

  constructor(
    private walletService: WalletService,
    private walletManager: WalletManager
  ) {
    super();
  }

  async execute(ctx: Context, session?: Session): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await this.sendError(ctx, 'Unable to identify user.');
      return;
    }

    const message = 'text' in (ctx.message ?? {}) ? (ctx.message as { text: string }).text : '';
    const args = extractCommandArgs(message, this.command);
    const subcommand = args[0]?.toLowerCase();

    try {
      switch (subcommand) {
        case 'add':
          await this.handleAdd(ctx, userId, args.slice(1));
          break;
        case 'list':
          await this.handleList(ctx, userId);
          break;
        case 'balance':
          await this.handleBalance(ctx, userId, args[1]);
          break;
        case 'remove':
          await this.handleRemove(ctx, userId, args[1]);
          break;
        default:
          await this.sendInfo(
            ctx,
            `Usage: /wallet <add|list|balance|remove>\n\n` +
              `• add <private_key> <name> - Add a trading wallet\n` +
              `• list - List all your wallets\n` +
              `• balance [wallet_id] - Check wallet balance\n` +
              `• remove <wallet_id> - Remove a wallet`
          );
      }
    } catch (error) {
      logger.error('Wallet command failed', error as Error, { userId, subcommand });
      await this.sendError(ctx, 'An error occurred processing your request.');
    }
  }

  private async handleAdd(ctx: Context, userId: number, args: string[]): Promise<void> {
    if (args.length < 2) {
      await this.sendError(ctx, 'Usage: /wallet add <private_key> <name>');
      return;
    }

    const privateKey = args[0];
    const name = args.slice(1).join(' ');

    try {
      const wallet = await this.walletManager.addWallet(userId, privateKey, name);
      await this.sendSuccess(
        ctx,
        `✅ Wallet added successfully!\n\n` +
          `Name: ${wallet.name}\n` +
          `Public Key: \`${wallet.publicKey.substring(0, 16)}...\``
      );
    } catch (error) {
      logger.error('Failed to add wallet', error as Error, { userId });
      await this.sendError(ctx, 'Failed to add wallet. Please check your private key.');
    }
  }

  private async handleList(ctx: Context, userId: number): Promise<void> {
    try {
      const wallets = await this.walletService.getUserWallets(userId);

      if (wallets.length === 0) {
        await this.sendInfo(ctx, 'No wallets found. Use /wallet add to add one.');
        return;
      }

      let message = `**Your Wallets**\n\n`;
      for (const wallet of wallets) {
        const status = wallet.isActive ? '✅ Active' : '❌ Inactive';
        message += `**${wallet.name}** (ID: ${wallet.id})\n`;
        message += `${status}\n`;
        message += `\`${wallet.publicKey.substring(0, 16)}...\`\n\n`;
      }

      await this.sendInfo(ctx, message);
    } catch (error) {
      logger.error('Failed to list wallets', error as Error, { userId });
      await this.sendError(ctx, 'Failed to retrieve wallets.');
    }
  }

  private async handleBalance(ctx: Context, userId: number, walletIdStr?: string): Promise<void> {
    try {
      let wallet;
      if (walletIdStr) {
        const walletId = parseInt(walletIdStr);
        wallet = await this.walletService.getWallet(walletId);
        if (!wallet || wallet.userId !== userId) {
          await this.sendError(ctx, 'Wallet not found.');
          return;
        }
      } else {
        wallet = await this.walletService.getActiveWallet(userId);
        if (!wallet) {
          await this.sendError(ctx, 'No active wallet found. Use /wallet add to add one.');
          return;
        }
      }

      const balance = await this.walletService.getBalance(wallet.id);
      await this.sendInfo(
        ctx,
        `**Wallet Balance**\n\n` +
          `Name: ${wallet.name}\n` +
          `Balance: ${balance.toFixed(4)} SOL\n` +
          `Public Key: \`${wallet.publicKey.substring(0, 16)}...\``
      );
    } catch (error) {
      logger.error('Failed to get balance', error as Error, { userId });
      await this.sendError(ctx, 'Failed to retrieve wallet balance.');
    }
  }

  private async handleRemove(ctx: Context, userId: number, walletIdStr?: string): Promise<void> {
    if (!walletIdStr) {
      await this.sendError(ctx, 'Usage: /wallet remove <wallet_id>');
      return;
    }

    try {
      const walletId = parseInt(walletIdStr);
      const wallet = await this.walletService.getWallet(walletId);
      
      if (!wallet || wallet.userId !== userId) {
        await this.sendError(ctx, 'Wallet not found.');
        return;
      }

      await this.walletManager.removeWallet(walletId);
      await this.sendSuccess(ctx, `✅ Wallet "${wallet.name}" removed successfully.`);
    } catch (error) {
      logger.error('Failed to remove wallet', error as Error, { userId, walletIdStr });
      await this.sendError(ctx, 'Failed to remove wallet.');
    }
  }
}

