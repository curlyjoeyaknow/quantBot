/**
 * Alerts Command Handler
 * ======================
 * Handles the /alerts command for displaying all tracked tokens and
 * configured alerts in a paginated table format.
 */
import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { SessionService } from '../services/SessionService';
export declare class AlertsCommandHandler extends BaseCommandHandler {
    private sessionService;
    readonly command = "alerts";
    constructor(sessionService: SessionService);
    execute(ctx: Context, session?: Session): Promise<void>;
}
//# sourceMappingURL=AlertsCommandHandler.d.ts.map