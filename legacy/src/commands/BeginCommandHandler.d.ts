/**
 * Begin Command Handler
 * =====================
 * Handles the /begin command for welcoming new users and showing available commands.
 */
import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
export declare class BeginCommandHandler extends BaseCommandHandler {
    readonly command = "begin";
    execute(ctx: Context, session?: Session): Promise<void>;
}
//# sourceMappingURL=BeginCommandHandler.d.ts.map