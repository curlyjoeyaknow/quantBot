/**
 * Strategy Service
 * ================
 * Manages trading strategy operations including CRUD operations.
 * Wraps database operations with a clean service interface.
 */
import { Strategy } from '../simulation/engine';
import { StopLossConfig } from '../simulation/config';
export interface StrategyData {
    name: string;
    description?: string;
    strategy: Strategy[];
    stopLossConfig: StopLossConfig;
    isDefault?: boolean;
}
export interface SavedStrategy {
    id: number;
    name: string;
    description?: string;
    strategy: Strategy[];
    stopLossConfig: StopLossConfig;
    isDefault: boolean;
    createdAt: any;
}
/**
 * Service for managing trading strategies
 */
export declare class StrategyService {
    /**
     * Save a new strategy or update an existing one
     */
    saveStrategy(userId: number, strategyData: StrategyData): Promise<number>;
    /**
     * Get all strategies for a user
     */
    getUserStrategies(userId: number): Promise<SavedStrategy[]>;
    /**
     * Get a specific strategy by name for a user
     */
    getStrategy(userId: number, name: string): Promise<SavedStrategy | null>;
    /**
     * Delete a strategy
     */
    deleteStrategy(userId: number, name: string): Promise<void>;
    /**
     * Check if a strategy exists for a user
     */
    strategyExists(userId: number, name: string): Promise<boolean>;
    /**
     * Get default strategy for a user
     */
    getDefaultStrategy(userId: number): Promise<SavedStrategy | null>;
    /**
     * Set a strategy as default
     */
    setDefaultStrategy(userId: number, name: string): Promise<void>;
}
export declare const strategyService: StrategyService;
//# sourceMappingURL=StrategyService.d.ts.map