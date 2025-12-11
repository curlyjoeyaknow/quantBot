/**
 * Strategy Presets
 *
 * Predefined strategy configurations
 */
import { StrategyConfig, StrategyPresetName } from './types';
/**
 * Get a strategy preset by name
 */
export declare function getPreset(name: StrategyPresetName): StrategyConfig | null;
/**
 * Register a new preset
 */
export declare function registerPreset(name: StrategyPresetName, config: StrategyConfig): void;
/**
 * List all available preset names
 */
export declare function listPresets(): StrategyPresetName[];
//# sourceMappingURL=presets.d.ts.map