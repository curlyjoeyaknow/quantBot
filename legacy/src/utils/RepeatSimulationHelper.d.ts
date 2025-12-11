/**
 * Repeat Simulation Helper
 * =======================
 * Utility functions for repeating simulations from previous runs.
 * Extracted from bot.ts to improve modularity and reusability.
 */
import { Context } from 'telegraf';
import { SessionService } from '../services/SessionService';
export declare class RepeatSimulationHelper {
    private sessionService;
    constructor(sessionService: SessionService);
    /**
     * Primes a session from a previous run's parameters so user can rerun/re-edit.
     */
    repeatSimulation(ctx: Context, run: any): Promise<void>;
}
//# sourceMappingURL=RepeatSimulationHelper.d.ts.map