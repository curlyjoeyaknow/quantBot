/**
 * Core simulation models
 *
 * Defines the core data structures used throughout the simulation engine.
 * These types are shared between the engine, services, and storage layers.
 */
/**
 * OHLCV Candle
 */
export interface Candle {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}
/**
 * Trade execution
 */
export interface Trade {
    id: string;
    tokenAddress: string;
    chain: string;
    side: 'buy' | 'sell';
    price: number;
    size: number;
    timestamp: number;
    pnl?: number;
    metadata?: Record<string, unknown>;
}
/**
 * Position state during simulation
 */
export interface Position {
    tokenAddress: string;
    chain: string;
    size: number;
    entryPrice: number;
    entryTimestamp: number;
    currentPrice: number;
    unrealizedPnl: number;
    realizedPnl: number;
    stopLoss?: number;
    trailingStop?: number;
    profitTargets: Array<{
        target: number;
        percent: number;
        hit: boolean;
    }>;
}
/**
 * Simulation event
 */
export interface SimulationEvent {
    type: 'entry' | 'stop_moved' | 'target_hit' | 'stop_loss' | 'final_exit' | 'trailing_entry_triggered' | 're_entry' | 'ladder_entry' | 'ladder_exit';
    timestamp: number;
    price: number;
    description: string;
    remainingPosition: number;
    pnlSoFar: number;
    indicators?: Record<string, unknown>;
    positionState?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}
/**
 * Simulation aggregate metrics
 */
export interface SimulationAggregate {
    tokenAddress: string;
    chain: string;
    finalPnl: number;
    maxDrawdown: number;
    volatility: number;
    sharpeRatio: number;
    sortinoRatio: number;
    winRate: number;
    tradeCount: number;
    reentryCount: number;
    ladderEntriesUsed: number;
    ladderExitsUsed: number;
}
/**
 * Complete simulation trace
 */
export interface SimulationTrace {
    trades: Trade[];
    events: SimulationEvent[];
    aggregates: SimulationAggregate;
}
//# sourceMappingURL=models.d.ts.map