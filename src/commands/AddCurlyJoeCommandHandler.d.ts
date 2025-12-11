/**
 * Add CurlyJoe Command Handler
 * ============================
 * Allows users to easily add recent calls from CurlyJoe channel to live monitoring
 * with Ichimoku and price/volume alerts configured by default.
 */
import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
export declare class AddCurlyJoeCommandHandler extends BaseCommandHandler {
    readonly command = "addcurlyjoe";
    execute(ctx: Context, session?: Session): Promise<void>;
    /**
     * Handle callback query for adding a specific call
     */
    static handleCallback(ctx: Context, data: string, session?: Session): Promise<void>;
}
//# sourceMappingURL=AddCurlyJoeCommandHandler.d.ts.map