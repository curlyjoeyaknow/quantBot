/**
 * Strategy Builder
 *
 * Builds strategy configurations from various inputs
 */
import { StrategyConfig, StrategyPresetName } from './types';
import { Strategy } from '../engine';
/**
 * Converts StrategyConfig to the format expected by simulateStrategy
 */
export declare function buildStrategy(config: StrategyConfig): Strategy[];
/**
 * Converts StrategyConfig to StopLossConfig format
 */
export declare function buildStopLossConfig(config: StrategyConfig): import('../engine').StopLossConfig | undefined;
/**
 * Converts StrategyConfig to EntryConfig format
 */
export declare function buildEntryConfig(config: StrategyConfig): import('../engine').EntryConfig | undefined;
/**
 * Converts StrategyConfig to ReEntryConfig format
 */
export declare function buildReEntryConfig(config: StrategyConfig): import('../engine').ReEntryConfig | undefined;
/**
 * Build a strategy from a preset name
 */
export declare function buildFromPreset(presetName: StrategyPresetName): StrategyConfig | null;
/**
 * Validate a strategy configuration
 */
export declare function validateStrategy(config: StrategyConfig): {
    valid: boolean;
    errors: string[];
};
//# sourceMappingURL=builder.d.ts.map