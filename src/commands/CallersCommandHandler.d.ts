/**
 * Callers Command Handler
 * =======================
 * Handles the /callers command for showing top callers statistics
 * and database statistics.
 */
import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
export declare class CallersCommandHandler extends BaseCommandHandler {
    readonly command = "callers";
    execute(ctx: Context, session?: Session): Promise<void>;
}
//# sourceMappingURL=CallersCommandHandler.d.ts.map