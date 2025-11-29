/**
 * API Type Definitions
 * ====================
 * Type definitions for API requests and responses
 */

/**
 * Pagination parameters
 */
export interface PaginationParams {
  page: number;
  pageSize: number;
}

/**
 * Pagination metadata
 */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * Standard API response with data
 */
export interface ApiResponse<T> {
  data: T;
  meta?: PaginationMeta & {
    timestamp: string;
  };
}

/**
 * Standard API error response
 */
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
    timestamp: string;
    path?: string;
    requestId?: string;
  };
}

/**
 * Caller Alert types
 */
export interface CallerAlert {
  id: number;
  callerName: string;
  tokenAddress: string;
  tokenSymbol?: string;
  chain: string;
  alertTimestamp: string;
  priceAtAlert?: number;
  entryPrice?: number;
  marketCapAtCall?: number;
  maxPrice?: number;
  maxGainPercent?: number;
  timeToATH?: number;
  isDuplicate: boolean;
  currentPrice?: number;
  currentGainPercent?: number;
}

/**
 * Simulation types
 */
export interface Simulation {
  name: string;
  path: string;
  summary?: SimulationSummary;
  tradeHistoryPath?: string;
}

export interface SimulationSummary {
  totalTrades?: number;
  winRate?: number;
  totalReturn?: number;
  maxDrawdown?: number;
  sharpeRatio?: number;
  [key: string]: any;
}

/**
 * Optimization result types
 */
export interface OptimizationResult {
  caller?: string;
  strategy?: string;
  totalReturn?: number;
  winRate?: number;
  totalTrades?: number;
  maxDrawdown?: number;
  file: string;
}

/**
 * Dashboard metrics types
 */
export interface DashboardMetrics {
  totalCalls: number;
  pnlFromAlerts: number;
  maxDrawdown: number;
  currentDailyProfit: number;
  lastWeekDailyProfit: number;
  overallProfit: number;
  largestGain: number;
  profitSinceOctober: number;
}

/**
 * Service status types
 */
export interface ServiceStatus {
  name: string;
  status: 'running' | 'stopped' | 'unknown';
  pid?: number;
  lastCheck: string;
}

/**
 * Job status types
 */
export interface JobStatus {
  schedulerEnabled: boolean;
  strategyJob: {
    isRunning: boolean;
    progress: {
      current: number;
      total: number;
      percentage: number;
    };
    totalComputed: number;
  };
  dashboardMetrics: {
    lastComputed: string | null;
    ageMinutes: number | null;
    available: boolean;
  };
}

/**
 * Recording status types
 */
export interface RecordingStatus {
  recording: {
    active: boolean;
    lastTickTime: string | null;
  };
  database: {
    totalAlerts: number;
    totalCallers: number;
    totalTokens: number;
    earliestAlert: string | null;
    latestAlert: string | null;
    recentAlerts: number;
  };
  clickhouse: {
    totalTicks: number;
    lastTickTime: string | null;
  };
}

/**
 * Health check types
 */
export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  environment: string;
  backgroundJobsEnabled: boolean;
}

export interface DetailedHealthStatus {
  overallHealth: 'healthy' | 'degraded' | 'unhealthy';
  services: Array<{
    name: string;
    status: 'online' | 'offline' | 'degraded';
    lastCheck: string;
    details?: any;
  }>;
  recentActivity: Array<{
    type: string;
    timestamp: string;
    details?: any;
  }>;
  timestamp: string;
}

