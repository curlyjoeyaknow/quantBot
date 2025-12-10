/**
 * Text Workflow Handler
 * =====================
 * Handles the main text workflow for bot interactions including
 * session management, CA detection, and workflow delegation.
 */
import { Context } from 'telegraf';
import { SessionService } from './SessionService';
import { SimulationService } from './SimulationService';
import { StrategyService } from './StrategyService';
import { IchimokuWorkflowService } from './IchimokuWorkflowService';
import { CADetectionService } from './CADetectionService';
import { RepeatSimulationHelper } from '../utils/RepeatSimulationHelper';
export declare class TextWorkflowHandler {
    private sessionService;
    private simulationService;
    private strategyService;
    private ichimokuWorkflowService;
    private caDetectionService;
    private repeatHelper;
    constructor(sessionService: SessionService, simulationService: SimulationService, strategyService: StrategyService, ichimokuWorkflowService: IchimokuWorkflowService, caDetectionService: CADetectionService, repeatHelper: RepeatSimulationHelper);
    /**
     * Ensure session.data is initialized
     */
    private ensureSessionData;
    handleCallbackQuery(ctx: Context): Promise<void>;
    private handleTextInput;
    private handleBacktestSourceSelection;
    private handleBacktestSelection;
    private handleCallerSelection;
    handleText(ctx: Context): Promise<void>;
    private handleRunSelection;
    private handleSimulationWorkflow;
    private handleBacktestWorkflow;
    private runBacktestSimulation;
}
//# sourceMappingURL=TextWorkflowHandler.d.ts.map