/**
 * Repeat Simulation Helper
 * Utility functions for repeating simulations from previous runs.
 *
 * @deprecated This helper is deprecated and kept only for test coverage.
 * SessionService no longer exists in the codebase.
 *
 * This code should be removed when:
 * - Tests are migrated to use new session management
 * - Or tests are removed if functionality is no longer needed
 *
 * TODO: Remove this file and associated tests when session management is refactored.
 */

import type { Context } from 'telegraf';
import { DateTime } from 'luxon';

/**
 * @deprecated SessionService no longer exists. This interface is kept for test compatibility only.
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

    const mint = run.mint as string | undefined;
    const chain = run.chain as string | undefined;

    const metadata = {
      name: (run.token_name || run.tokenName) as string | undefined,
      symbol: (run.token_symbol || run.tokenSymbol) as string | undefined,
    };

    const startTime = run.startTime;
    const endTime = run.endTime;

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

    // Type guard for DateTime/Date conversion
    const startDt =
      startTime instanceof DateTime
        ? startTime
        : startTime instanceof Date
          ? DateTime.fromJSDate(startTime)
          : null;
    const endDt =
      endTime instanceof DateTime
        ? endTime
        : endTime instanceof Date
          ? DateTime.fromJSDate(endTime)
          : null;

    const startStr = startDt?.toFormat('yyyy-MM-dd HH:mm');
    const endStr = endDt?.toFormat('yyyy-MM-dd HH:mm');

    await ctx.reply(
      `🔄 **Repeating Simulation**\n\n` +
        `${chainEmoji} Chain: ${chain ? chain.toUpperCase() : 'UNKNOWN'}\n` +
        `🪙 Token: ${metadata.name || 'Unknown'} (${metadata.symbol || 'N/A'})\n` +
        `📅 Period: ${startStr || 'N/A'} - ${endStr || 'N/A'}\n\n` +
        `**Take Profit Strategy:**\n` +
        `• \`yes\` - Default: 50%@2x, 30%@5x, 20%@10x\n` +
        `• \`50@2x,30@5x,20@10x\` - Custom\n` +
        `• \`[{"percent":0.5,"target":2}]\` - JSON`,
      { parse_mode: 'Markdown' }
    );
  }
}
