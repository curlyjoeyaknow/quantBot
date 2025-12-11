/**
 * Options Command Handler
 * =======================
 * Handles the /options command for displaying all available commands and their descriptions.
 */
import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
export declare class OptionsCommandHandler extends BaseCommandHandler {
    readonly command = "options";
    execute(ctx: Context, session?: Session): Promise<void>;
}
//# sourceMappingURL=OptionsCommandHandler.d.ts.map