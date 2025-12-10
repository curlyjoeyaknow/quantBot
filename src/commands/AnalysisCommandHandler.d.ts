/**
 * Analysis Command Handler
 * ========================
 * Handles the /analysis command for running historical analysis on CA drops
 * and formatting/sending the results.
 */
import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
export declare class AnalysisCommandHandler extends BaseCommandHandler {
    readonly command = "analysis";
    execute(ctx: Context, session?: Session): Promise<void>;
}
//# sourceMappingURL=AnalysisCommandHandler.d.ts.map