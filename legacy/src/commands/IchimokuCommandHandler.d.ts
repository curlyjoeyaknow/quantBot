/**
 * Ichimoku Command Handler
 * ========================
 * Handles the /ichimoku command for initiating Ichimoku Cloud analysis
 * and monitoring workflows.
 */
import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { SessionService } from '../services/SessionService';
export declare class IchimokuCommandHandler extends BaseCommandHandler {
    private sessionService;
    readonly command = "ichimoku";
    constructor(sessionService: SessionService);
    execute(ctx: Context, session?: Session): Promise<void>;
}
//# sourceMappingURL=IchimokuCommandHandler.d.ts.map