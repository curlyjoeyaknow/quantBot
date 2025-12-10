/**
 * Backtest Command Handler
 * =======================
 * Handles the /backtest command for starting new simulation workflows.
 * Extracted from the monolithic bot.ts to improve modularity and testability.
 */
import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { SessionService } from '../services/SessionService';
export declare class BacktestCommandHandler extends BaseCommandHandler {
    private sessionService;
    readonly command = "backtest";
    constructor(sessionService: SessionService);
    execute(ctx: Context, session?: Session): Promise<void>;
}
//# sourceMappingURL=BacktestCommandHandler.d.ts.map