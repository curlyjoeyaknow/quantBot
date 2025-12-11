/**
 * Repeat Command Handler
 * ======================
 * Handles the /repeat command for repeating previous simulations.
 * Extracted from the monolithic bot.ts to improve modularity and testability.
 */
import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { SimulationService } from '../services/SimulationService';
import { SessionService } from '../services/SessionService';
import { RepeatSimulationHelper } from '../utils/RepeatSimulationHelper';
export declare class RepeatCommandHandler extends BaseCommandHandler {
    private simulationService;
    private sessionService;
    private repeatHelper;
    readonly command = "repeat";
    constructor(simulationService: SimulationService, sessionService: SessionService, repeatHelper: RepeatSimulationHelper);
    execute(ctx: Context, session?: Session): Promise<void>;
}
//# sourceMappingURL=RepeatCommandHandler.d.ts.map