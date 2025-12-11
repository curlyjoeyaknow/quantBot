/**
 * Database Module
 *
 * Provides a type-safe, maintainable API for accessing and modifying simulation and CA-tracking data
 * using a SQLite database.
 *
 * Sections:
 *   1. Database Initialization & Lifecycle
 *   2. Simulation Run Management
 *   3. Strategy Management
 *   4. CA Tracking & Alerts
 *   5. Utility Functions
 */
import { DateTime } from 'luxon';
/**
 * Initializes the SQLite database connection.
 * Creates required tables and indices if they do not exist.
 *
 * @returns {Promise<void>}
 */
export declare function initDatabase(): Promise<void>;
/**
 * Persists a simulation run and its events into the database.
 *
 * @param data Simulation run data + array of events
 * @returns {Promise<number>} The inserted row's run ID
 */
import { Strategy } from '../simulation/engine';
import { StopLossConfig } from '../simulation/config';
import { SimulationEvent } from '../types/session';
export declare function saveSimulationRun(data: {
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
    events: SimulationEvent[];
    entryType?: string;
    entryPrice?: number;
    entryTimestamp?: number;
    filterCriteria?: Record<string, unknown>;
    strategyName?: string;
}): Promise<number>;
/**
 * Retrieves recent simulation runs for a specific user, ordered by creation time (desc).
 *
 * @param userId User's identifier
 * @param limit Maximum number of runs to retrieve (default: 10)
 * @returns {Promise<any[]>}
 */
import { SimulationRunData } from '../types/session';
export declare function getUserSimulationRuns(userId: number, limit?: number): Promise<SimulationRunData[]>;
/**
 * Retrieves a simulation run and its details by run ID.
 *
 * @param runId Simulation run identifier
 * @returns {Promise<any|null>}
 */
export declare function getSimulationRun(runId: number): Promise<any | null>;
/**
 * Retrieves all events for a specific simulation run.
 *
 * @param runId Simulation run identifier
 * @returns {Promise<any[]>}
 */
export declare function getSimulationEvents(runId: number): Promise<any[]>;
/**
 * Persists a user-defined simulation strategy to the database, replacing any existing with same name.
 *
 * @param data Strategy data object
 * @returns {Promise<number>} The inserted (or replaced) strategy's ID
 */
export declare function saveStrategy(data: {
    userId: number;
    name: string;
    description?: string;
    strategy: any[];
    stopLossConfig: any;
    isDefault?: boolean;
}): Promise<number>;
/**
 * Fetches all strategies defined by a specific user, newest first.
 *
 * @param userId User's identifier
 * @returns {Promise<any[]>}
 */
export declare function getUserStrategies(userId: number): Promise<any[]>;
/**
 * Fetches a specific strategy by user and strategy name.
 *
 * @param userId User's identifier
 * @param name Strategy name (unique per user)
 * @returns {Promise<any|null>}
 */
export declare function getStrategy(userId: number, name: string): Promise<any | null>;
/**
 * Deletes a user's strategy by name.
 *
 * @param userId User's identifier
 * @param name Strategy name to delete
 * @returns {Promise<void>}
 */
export declare function deleteStrategy(userId: number, name: string): Promise<void>;
/**
 * Saves a new CA drop for auto-tracking by the CA system.
 *
 * @param data CA drop and associated strategy configuration details
 * @returns {Promise<number>} The inserted CA tracking entry's ID
 */
export declare function saveCADrop(data: {
    userId: number;
    chatId: number;
    mint: string;
    chain: string;
    tokenName?: string;
    tokenSymbol?: string;
    callPrice: number;
    callMarketcap?: number;
    callTimestamp: number;
    strategy: any[];
    stopLossConfig: any;
}): Promise<number>;
/**
 * Returns all currently active CA tracking entries, with fully parsed config fields.
 *
 * @returns {Promise<any[]>}
 */
export declare function getActiveCATracking(): Promise<any[]>;
export interface TrackedToken {
    mint: string;
    chain: string;
    tokenName?: string;
    tokenSymbol?: string;
    firstSeen?: number;
    source: 'ca_tracking' | 'token_registry' | 'pumpfun_launch' | 'pumpfun_graduated';
}
export interface PumpfunTokenRecord {
    mint: string;
    creator?: string;
    bondingCurve?: string;
    launchSignature?: string;
    launchTimestamp?: number;
    graduationSignature?: string;
    graduationTimestamp?: number;
    isGraduated: boolean;
    metadata?: Record<string, unknown> | null;
}
export declare function upsertPumpfunToken(record: PumpfunTokenRecord): Promise<void>;
export declare function markPumpfunGraduated(mint: string, data: {
    graduationSignature?: string;
    graduationTimestamp?: number;
}): Promise<void>;
export declare function getPumpfunTokenRecords(): Promise<PumpfunTokenRecord[]>;
export declare function getTrackedTokens(): Promise<TrackedToken[]>;
/**
 * Save a price update for a tracked CA.
 *
 * @param caId ID of the CA tracking row
 * @param price Price value
 * @param marketcap Marketcap value
 * @param timestamp Update timestamp (seconds)
 * @returns {Promise<void>}
 */
export declare function savePriceUpdate(caId: number, price: number, marketcap: number, timestamp: number): Promise<void>;
/**
 * Save an alert that was sent to a user for a CA.
 *
 * @param caId CA tracking row ID
 * @param alertType Type of alert
 * @param price The current price
 * @param timestamp Alert timestamp (seconds)
 * @returns {Promise<void>}
 */
export declare function saveAlertSent(caId: number, alertType: string, price: number, timestamp: number): Promise<void>;
/**
 * Get summary of recent CA performances over the past `hours`.
 *
 * @param hours How many hours back to look (default: 24)
 * @returns {Promise<any[]>}
 */
export declare function getRecentCAPerformance(hours?: number): Promise<any[]>;
/**
 * Get all CA calls from the database
 * @param limit Maximum number of calls to return
 * @returns Array of CA call objects
 */
import { CACall } from '../types/session';
export declare function getAllCACalls(limit?: number): Promise<CACall[]>;
/**
 * Get a specific CA call by mint address
 * @param mint The mint address to search for
 * @returns CA call object or null if not found
 */
export declare function getCACallByMint(mint: string): Promise<any | null>;
/**
 * Get CA calls by caller
 * @param caller The caller name to search for
 * @param limit Maximum number of calls to return
 * @returns Array of CA call objects
 */
export declare function getCACallsByCaller(caller: string, limit?: number): Promise<any[]>;
/**
 * Get CA calls by chain
 * @param chain The chain to search for
 * @param limit Maximum number of calls to return
 * @returns Array of CA call objects
 */
export declare function getCACallsByChain(chain: string, limit?: number): Promise<any[]>;
/**
 * Save a CA call to the historical calls table
 * @param callData The CA call data to save
 * @returns Promise<number> The ID of the inserted call
 */
export declare function saveCACall(callData: {
    mint: string;
    chain: string;
    tokenName?: string;
    tokenSymbol?: string;
    callPrice?: number;
    callMarketcap?: number;
    callTimestamp: number;
    caller?: string;
    sourceChatId?: number;
}): Promise<number>;
/**
 * Gracefully closes the database connection if open.
 *
 * @returns {Promise<void>}
 */
export declare function closeDatabase(): Promise<void>;
//# sourceMappingURL=database.d.ts.map