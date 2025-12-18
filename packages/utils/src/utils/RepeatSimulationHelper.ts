/**
 * Repeat Simulation Helper
 * Utility functions for repeating simulations from previous runs.
 * NOTE: Extracted from bot-specific code; kept here for test coverage.
 */

import type { Context } from 'telegraf';
import { DateTime } from 'luxon';

/**
 * @deprecated SessionService no longer exists. This helper is kept for test coverage only.
 * TODO: Remove or refactor to use a different service interface.
 */
export interface SessionService {
  setSession(userId: number, session: unknown): void;
}

export class RepeatSimulationHelper {
  constructor(private sessionService: SessionService) {}

  /**
   * Prime a session from a previous run's parameters so user can rerun/re-edit.
   * Preserves full mint address and chain metadata.
   */
  async repeatSimulation(ctx: Context, run: Record<string, unknown>): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply('❌ Unable to identify user.');
      return;
    }

    const mint = run.mint;
    const chain = run.chain;

    const metadata = {
      name: run.token_name || run.tokenName,
      symbol: run.token_symbol || run.tokenSymbol,
    };

    const startTime = run.startTime;

    const newSession: Record<string, unknown> = {
      step: 'waiting_for_strategy',
      type: 'repeat',
      data: {
        mint,
        chain,
        datetime: startTime,
        metadata,
        strategy: undefined,
        stopLossConfig: undefined,
        lastSimulation: {
          mint,
          chain,
          datetime: startTime,
          metadata,
          candles: [],
        },
      },
    };

    this.sessionService.setSession(userId, newSession);

    const chainEmoji =
      chain === 'ethereum' ? '⟠' : chain === 'bsc' ? '🟡' : chain === 'base' ? '🔵' : '◎';

    const startDt =
      startTime instanceof DateTime ? startTime : startTime ? DateTime.fromJSDate(startTime) : null;
    const endDt =
      run.endTime instanceof DateTime
        ? run.endTime
        : run.endTime
          ? DateTime.fromJSDate(run.endTime)
          : null;

    const startStr = startDt?.toFormat('yyyy-MM-dd HH:mm');
    const endStr = endDt?.toFormat('yyyy-MM-dd HH:mm');

    await ctx.reply(
      `🔄 **Repeating Simulation**\n\n` +
        `${chainEmoji} Chain: ${chain.toUpperCase()}\n` +
        `🪙 Token: ${metadata.name} (${metadata.symbol})\n` +
        `📅 Period: ${startStr} - ${endStr}\n\n` +
        `**Take Profit Strategy:**\n` +
        `• \`yes\` - Default: 50%@2x, 30%@5x, 20%@10x\n` +
        `• \`50@2x,30@5x,20@10x\` - Custom\n` +
        `• \`[{"percent":0.5,"target":2}]\` - JSON`,
      { parse_mode: 'Markdown' }
    );
  }
}
