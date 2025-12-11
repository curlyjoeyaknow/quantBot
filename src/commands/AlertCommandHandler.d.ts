/**
 * Alert Command Handler
 * ====================
 * Handles the /alert command for manually flagging tokens for monitoring
 * and basic price alerts.
 */
import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
export declare class AlertCommandHandler extends BaseCommandHandler {
    readonly command = "alert";
    execute(ctx: Context, session?: Session): Promise<void>;
}
//# sourceMappingURL=AlertCommandHandler.d.ts.map