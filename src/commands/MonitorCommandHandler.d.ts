/**
 * Monitor Command Handler
 * =======================
 * Handles the /monitor command for real-time Ichimoku Tenkan/Kijun cross monitoring
 * of specific token mints.
 */
import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
export declare class MonitorCommandHandler extends BaseCommandHandler {
    readonly command = "monitor";
    execute(ctx: Context, session?: Session): Promise<void>;
}
//# sourceMappingURL=MonitorCommandHandler.d.ts.map