/**
 * Ichimoku Workflow Service
 * ========================
 * Handles Ichimoku Cloud analysis workflow including token validation,
 * historical data fetching, and real-time monitoring setup.
 */
import { Context } from 'telegraf';
import { SessionService } from '../services/SessionService';
import { Session } from '../commands/interfaces/CommandHandler';
export declare class IchimokuWorkflowService {
    private sessionService;
    constructor(sessionService: SessionService);
    /**
     * Handles the Ichimoku workflow steps for token address and chain selection.
     */
    handleIchimokuWorkflow(ctx: Context, session: Session, text: string): Promise<void>;
    /**
     * Starts the Ichimoku analysis process including data fetching and monitoring setup.
     */
    startIchimokuAnalysis(ctx: Context, session: Session): Promise<void>;
}
//# sourceMappingURL=IchimokuWorkflowService.d.ts.map