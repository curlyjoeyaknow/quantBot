/**
 * Service Interfaces
 * ==================
 * Defines contracts for core services to enable dependency injection
 * and improve testability.
 */

// TODO: Session type should be defined in this package or @quantbot/bot
// import { Session } from '@quantbot/bot';
type Session = any; // Temporary placeholder

/**
 * Service for managing user sessions
 */
export interface SessionService {
  getSession(userId: number): Session | undefined;
  setSession(userId: number, session: Session): void;
  clearSession(userId: number): void;
  getAllSessions(): Record<number, Session>;
}

/**
 * Service for simulation operations
 */
export interface SimulationService {
  runSimulation(params: SimulationParams): Promise<SimulationResult>;
  getUserSimulationRuns(userId: number): Promise<any[]>;
  repeatSimulation(userId: number, runId: string): Promise<SimulationResult>;
}

/**
 * Service for strategy management
 */
export interface StrategyService {
  getUserStrategies(userId: number): Promise<any[]>;
  getStrategy(userId: number, name: string): Promise<any | null>;
  saveStrategy(userId: number, strategy: any): Promise<void>;
  deleteStrategy(userId: number, name: string): Promise<void>;
}

/**
 * Service for CA (Contract Address) operations
 */
export interface CAService {
  detectCADrop(message: string): { mint: string; chain: string } | null;
  validateTokenAddress(mint: string, chain: string): Promise<boolean>;
  fetchTokenMetadata(mint: string, chain: string): Promise<any>;
  addCATracking(params: CATrackingParams): Promise<void>;
}

/**
 * Service for data extraction and analysis
 */
export interface AnalysisService {
  extractCADrops(): Promise<void>;
  runHistoricalAnalysis(): Promise<string>;
  getCACallHistory(limit?: number): Promise<any[]>;
}

/**
 * Service for alert management
 */
export interface AlertService {
  getUserAlerts(userId: number): Promise<any[]>;
  createAlert(userId: number, params: AlertParams): Promise<void>;
  deleteAlert(userId: number, alertId: string): Promise<void>;
}

// Type definitions for service parameters
export interface SimulationParams {
  mint: string;
  chain: string;
  startTime: string;
  strategy: any[];
  stopLossConfig: any;
  userId: number;
}

export interface SimulationResult {
  finalPnl: number;
  events: any[];
  entryPrice: number;
  finalPrice: number;
  totalCandles: number;
}

export interface CATrackingParams {
  userId: number;
  chatId: number;
  mint: string;
  chain: string;
  tokenName: string;
  tokenSymbol: string;
  callPrice: number;
  strategy: any[];
  stopLossConfig: any;
}

export interface AlertParams {
  mint: string;
  chain: string;
  tokenName: string;
  tokenSymbol: string;
  strategy: any[];
  stopLossConfig: any;
}
