/**
 * Shared TypeScript types and interfaces for front-end components
 */

// Dashboard Types
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

// Caller History Types
export interface CallerHistoryRow {
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
  timeToATH?: number | null;
  isDuplicate: boolean;
}

export interface CallerHistoryFilters {
  caller: string;
  startDate: string;
  endDate: string;
  minMarketCap: string;
  maxMarketCap: string;
  minMaxGain: string;
  maxMaxGain: string;
  isDuplicate: string;
}

export interface CallerHistoryResponse {
  data: CallerHistoryRow[];
  total: number;
}

// Recent Alerts Types
export interface RecentAlertRow extends CallerHistoryRow {
  currentPrice?: number;
  currentGainPercent?: number;
}

export interface RecentAlertsResponse {
  data: RecentAlertRow[];
  total: number;
}

// Callers Types
export interface CallerStat {
  name: string;
  totalCalls: number;
  uniqueTokens: number;
  firstCall: string;
  lastCall: string;
  avgPrice: number | null;
  avgMarketCap: number | null;
}

export interface CallerStatsData {
  callers: CallerStat[];
  totals: {
    total_calls: number;
    total_callers: number;
    total_tokens: number;
    earliest_call: string | null;
    latest_call: string | null;
  };
}

export interface CallersResponse {
  data: string[];
}

// Health Types
export interface ServiceStatus {
  name: string;
  status: 'online' | 'offline' | 'degraded';
  lastCheck: string;
  details?: Record<string, unknown>;
}

export interface ActivityItem {
  type: string;
  caller?: string;
  count?: number;
  timestamp: string;
}

export interface HealthData {
  overallHealth: 'healthy' | 'degraded' | 'unhealthy';
  services: ServiceStatus[];
  recentActivity: ActivityItem[];
  timestamp: string;
}

// Control Panel Types
export interface ControlPanelServiceStatus {
  name: string;
  status: 'running' | 'stopped' | 'unknown';
  pid?: number;
  lastCheck: string;
}

export interface ConfigValue {
  key: string;
  value: string;
  description?: string;
  type: 'string' | 'number' | 'boolean' | 'secret';
}

export interface ControlPanelServicesResponse {
  services: ControlPanelServiceStatus[];
}

export interface ControlPanelConfigResponse {
  config: ConfigValue[];
}

// Recording Types
export interface RecordingData {
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

// Simulations Types
export interface Simulation {
  name: string;
  path: string;
  summary?: SimulationSummary;
  tradeHistoryPath?: string;
}

export interface SimulationSummary {
  finalPortfolio?: number;
  initialPortfolio?: number;
  totalTrades?: number;
  winRate?: number;
  [key: string]: unknown;
}

export interface SimulationDetails {
  summary?: SimulationSummary;
  tradeHistory?: Record<string, unknown>[];
}

export interface SimulationsResponse {
  data: Simulation[];
}

// Optimizations Types
export interface OptimizationResult {
  caller?: string;
  strategy?: string;
  totalReturn?: number;
  winRate?: number;
  totalTrades?: number;
  maxDrawdown?: number;
  file: string;
}

export interface OptimizationsResponse {
  data: OptimizationResult[];
}

// API Response Types
export interface ApiError {
  error: string;
  message?: string;
  statusCode?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page?: number;
  pageSize?: number;
}

// Common Types
export type LoadingState = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

