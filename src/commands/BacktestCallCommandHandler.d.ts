/**
 * Backtest Call Command Handler
 * =============================
 * Handles the /backtest_call command for backtesting historical CA calls
 * with strategies.
 */
import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { SessionService } from '../services/SessionService';
import { SimulationService } from '../services/SimulationService';
export declare class BacktestCallCommandHandler extends BaseCommandHandler {
    private sessionService;
    private simulationService;
    readonly command = "backtest_call";
    constructor(sessionService: SessionService, simulationService: SimulationService);
    execute(ctx: Context, session?: Session): Promise<void>;
}
//# sourceMappingURL=BacktestCallCommandHandler.d.ts.map