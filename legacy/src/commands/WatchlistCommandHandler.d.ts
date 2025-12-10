/**
 * Watchlist Command Handler
 * =========================
 * View and manage the watchlist of monitored tokens
 */
import { Context } from 'telegraf';
import { BaseCommandHandler } from './interfaces/CommandHandler';
export declare class WatchlistCommandHandler extends BaseCommandHandler {
    readonly command = "watchlist";
    execute(ctx: Context): Promise<void>;
    /**
     * Handle callback queries for watchlist actions
     */
    static handleCallback(ctx: Context, data: string): Promise<void>;
}
//# sourceMappingURL=WatchlistCommandHandler.d.ts.map