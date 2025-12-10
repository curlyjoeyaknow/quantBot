/**
 * Live Trade Command Handler
 * ==========================
 * Handles commands for starting/stopping live trade alert monitoring
 */
import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { LiveTradeAlertService } from '../monitoring/live-trade-alert-service';
export declare class LiveTradeCommandHandler extends BaseCommandHandler {
    readonly command = "livetrade";
    execute(ctx: Context, session?: Session): Promise<void>;
    private handleStart;
    private handleStop;
    private handleStatus;
    /**
     * Get the service instance (for external use)
     */
    static getService(): LiveTradeAlertService | null;
}
//# sourceMappingURL=LiveTradeCommandHandler.d.ts.map