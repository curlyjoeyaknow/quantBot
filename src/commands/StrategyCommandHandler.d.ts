/**
 * Strategy Command Handler
 * ========================
 * Handles the /strategy command for managing custom trading strategies.
 * Supports save, use, delete, and list operations.
 */
import { Context } from 'telegraf';
import { BaseCommandHandler, Session } from './interfaces/CommandHandler';
import { StrategyService } from '../services/StrategyService';
export declare class StrategyCommandHandler extends BaseCommandHandler {
    private strategyService;
    readonly command = "strategy";
    constructor(strategyService: StrategyService);
    execute(ctx: Context, session?: Session): Promise<void>;
    private handleListStrategies;
    private handleSaveStrategy;
    private handleUseStrategy;
    private handleDeleteStrategy;
    private parseStrategy;
    private parseStopLoss;
}
//# sourceMappingURL=StrategyCommandHandler.d.ts.map