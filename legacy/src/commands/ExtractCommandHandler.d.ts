/**
 * Extract Command Handler
 * ======================
 * Handles the /extract command for extracting CA drops from chat messages
 * and saving them to the database.
 */
import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
export declare class ExtractCommandHandler extends BaseCommandHandler {
    readonly command = "extract";
    execute(ctx: Context, session?: Session): Promise<void>;
}
//# sourceMappingURL=ExtractCommandHandler.d.ts.map