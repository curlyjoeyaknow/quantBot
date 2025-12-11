/**
 * History Command Handler
 * =======================
 * Handles the /history command for showing historical CA calls/alerts
 * stored in the database.
 */
import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
export declare class HistoryCommandHandler extends BaseCommandHandler {
    readonly command = "history";
    execute(ctx: Context, session?: Session): Promise<void>;
}
//# sourceMappingURL=HistoryCommandHandler.d.ts.map