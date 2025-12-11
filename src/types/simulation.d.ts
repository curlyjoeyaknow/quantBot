/**
 * Simulation and trading strategy types
 */
export interface TradingStrategy {
    name: string;
    description: string;
    takeProfit: TakeProfitTarget[];
    stopLoss: StopLossConfig;
    reentry?: ReentryConfig;
}
export interface TakeProfitTarget {
    percentage: number;
    multiplier: number;
}
export interface StopLossConfig {
    initial: number;
    trailing?: number;
}
export interface ReentryConfig {
    enabled: boolean;
    reentryPriceFactor: number;
    reentryStopLoss: number;
}
export interface SimulationConfig {
    initialBalance: number;
    positionSize: number;
    slippage: number;
    fees: number;
    tradingRules: TradingStrategy;
}
export interface SimulationResult {
    id: string;
    tokenAddress: string;
    chain: string;
    startTime: Date;
    endTime: Date;
    initialBalance: number;
    finalBalance: number;
    totalPnL: number;
    totalPnLPercent: number;
    trades: Trade[];
    events: SimulationEvent[];
    strategy: TradingStrategy;
}
export interface Trade {
    id: string;
    timestamp: Date;
    type: 'buy' | 'sell';
    price: number;
    amount: number;
    value: number;
    reason: string;
}
export interface SimulationEvent {
    timestamp: Date;
    type: 'entry' | 'take_profit' | 'stop_loss' | 'reentry' | 'exit';
    price: number;
    amount: number;
    description: string;
}
//# sourceMappingURL=simulation.d.ts.map