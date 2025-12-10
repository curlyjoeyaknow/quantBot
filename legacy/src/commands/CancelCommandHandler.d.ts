/**
 * Cancel Command Handler
 * ======================
 * Handles the /cancel command for clearing user sessions.
 * Extracted from the monolithic bot.ts to improve modularity and testability.
 */
import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { SessionService } from '../services/SessionService';
export declare class CancelCommandHandler extends BaseCommandHandler {
    private sessionService;
    readonly command = "cancel";
    constructor(sessionService: SessionService);
    execute(ctx: Context, session?: Session): Promise<void>;
}
//# sourceMappingURL=CancelCommandHandler.d.ts.map