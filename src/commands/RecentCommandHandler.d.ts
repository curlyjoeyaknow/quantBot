/**
 * Recent Command Handler
 * ======================
 * Handles the /recent command for showing recent CA calls
 * from the database.
 */
import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
export declare class RecentCommandHandler extends BaseCommandHandler {
    readonly command = "recent";
    execute(ctx: Context, session?: Session): Promise<void>;
}
//# sourceMappingURL=RecentCommandHandler.d.ts.map