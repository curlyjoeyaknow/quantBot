/**
 * StrategyEngine exports for Golden Path
 */

export { simulateOnCalls, type SimulationRequest, type SimulationTrace } from './StrategyEngine.js';
export { parseStrategyConfig, type StrategyConfig } from './StrategyConfig.js';
export * from './TradeLifecycle.js';

// Re-export validateStrategy from strategies/builder for convenience
export { validateStrategy } from '../strategies/builder.js';

// Alias simulateOnCalls as simulateToken for backwards compatibility
export { simulateOnCalls as simulateToken } from './StrategyEngine.js';
