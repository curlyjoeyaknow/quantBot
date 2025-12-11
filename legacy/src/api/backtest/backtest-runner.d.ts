/**
 * Backtest Runner
 *
 * Shared logic for running single backtests
 */
import { DateTime } from 'luxon';
import { StopLossConfig, EntryConfig, ReEntryConfig, CostConfig } from '../../simulation/config';
import { type EntryType } from './entry-price-service';
export interface BacktestRunParams {
    userId: number;
    mint: string;
    chain: string;
    strategyId: number;
    stopLossConfig?: StopLossConfig;
    entryConfig?: EntryConfig;
    reEntryConfig?: ReEntryConfig;
    costConfig?: CostConfig;
    entryType?: EntryType;
    entryTime?: DateTime;
    startTime?: DateTime;
    endTime?: DateTime;
    durationHours?: number;
}
export interface BacktestRunResult {
    runId: number;
    result: any;
    entryPrice: any;
    token: any;
    timeRange: any;
}
/**
 * Run a single backtest
 */
export declare function runSingleBacktest(params: BacktestRunParams): Promise<BacktestRunResult>;
//# sourceMappingURL=backtest-runner.d.ts.map