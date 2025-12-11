/**
 * Calls Command Handler
 * =====================
 * Handles the /calls command for showing all historical calls for a specific token.
 * Displays caller name, timestamp, price, chain info.
 */
import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
export declare class CallsCommandHandler extends BaseCommandHandler {
    readonly command = "calls";
    execute(ctx: Context, session?: Session): Promise<void>;
}
//# sourceMappingURL=CallsCommandHandler.d.ts.map