/**
 * Simulation Service
 * ==================
 * Manages simulation run operations including saving and retrieving simulation results.
 * Coordinates between the simulation engine and data persistence.
 */
import { DateTime } from 'luxon';
import { Strategy } from '../simulation/engine';
import { StopLossConfig } from '../simulation/config';
import { SimulationResult as SimResult } from '../simulate';
import { SimulationRunData } from '../types/session';
export interface SimulationRun {
    id: number;
    mint: string;
    chain: string;
    tokenName?: string;
    tokenSymbol?: string;
    startTime: DateTime;
    endTime: DateTime;
    strategy: Strategy[];
    stopLossConfig: StopLossConfig;
    finalPnl: number;
    totalCandles: number;
    createdAt: DateTime;
}
export interface SimulationParams {
    mint: string;
    chain: string;
    startTime: DateTime;
    endTime?: DateTime;
    strategy: Strategy[];
    stopLossConfig: StopLossConfig;
    userId: number;
}
/**
 * Service for managing simulation operations
 */
export declare class SimulationService {
    /**
     * Run a simulation with the given parameters
     */
    runSimulation(params: SimulationParams): Promise<SimResult>;
    /**
     * Save a simulation run to the database
     */
    saveSimulationRun(params: {
        userId: number;
        mint: string;
        chain: string;
        tokenName?: string;
        tokenSymbol?: string;
        startTime: DateTime;
        endTime: DateTime;
        strategy: Strategy[];
        stopLossConfig: StopLossConfig;
        finalPnl: number;
        totalCandles: number;
        events: any[];
    }): Promise<number>;
    /**
     * Get simulation runs for a user
     */
    getUserSimulationRuns(userId: number, limit?: number): Promise<SimulationRunData[]>;
    /**
     * Get a specific simulation run by ID
     */
    getSimulationRun(runId: number): Promise<SimulationRun | null>;
    /**
     * Run a complete simulation and save the results
     */
    runAndSaveSimulation(params: SimulationParams): Promise<SimResult & {
        runId: number;
    }>;
    /**
     * Repeat a previous simulation with the same parameters
     */
    repeatSimulation(userId: number, runIdOrIndex: number): Promise<SimResult>;
}
export declare const simulationService: SimulationService;
//# sourceMappingURL=SimulationService.d.ts.map