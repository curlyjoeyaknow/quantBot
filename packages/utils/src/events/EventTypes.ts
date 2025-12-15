/**
 * Event Types
 * ==========
 * Defines all event types used throughout the application.
 * Provides type safety and documentation for event-driven communication.
 */

import { BaseEvent } from './EventBus';
import type { Strategy, StopLossConfig, TokenAddress, Chain } from '@quantbot/core';

// ============================================================================
// User Events
// ============================================================================

export interface UserSessionEvent extends BaseEvent {
  type: 'user.session.started' | 'user.session.updated' | 'user.session.cleared';
  data: {
    userId: number;
    sessionData: Record<string, unknown>;
  };
}

export interface UserCommandEvent extends BaseEvent {
  type: 'user.command.executed' | 'user.command.failed';
  data: {
    userId: number;
    command: string;
    success: boolean;
    error?: string;
  };
}

export interface UserStrategyEvent extends BaseEvent {
  type: 'user.strategy.saved' | 'user.strategy.deleted' | 'user.strategy.used';
  data: {
    userId: number;
    strategyName: string;
    strategyData?: Strategy[];
  };
}

// ============================================================================
// Simulation Events
// ============================================================================

export interface SimulationEvent extends BaseEvent {
  type: 'simulation.started' | 'simulation.completed' | 'simulation.failed';
  data: {
    userId: number;
    mint: TokenAddress;
    chain: Chain;
    strategy: Strategy[];
    result?: Record<string, unknown>;
    error?: string;
  };
}

export interface SimulationRunEvent extends BaseEvent {
  type: 'simulation.run.saved' | 'simulation.run.retrieved' | 'simulation.run.repeated';
  data: {
    userId: number;
    runId: number;
    simulationData: Record<string, unknown>;
  };
}

// ============================================================================
// WebSocket Events
// ============================================================================

export interface WebSocketEvent extends BaseEvent {
  type:
    | 'websocket.connected'
    | 'websocket.disconnected'
    | 'websocket.error'
    | 'websocket.reconnecting';
  data: {
    url: string;
    reconnectAttempts?: number;
    error?: string;
  };
}

export interface WebSocketMessageEvent extends BaseEvent {
  type: 'websocket.message.received' | 'websocket.message.sent';
  data: {
    message: unknown;
    messageType: string;
  };
}

export interface WebSocketSubscriptionEvent extends BaseEvent {
  type: 'websocket.subscription.created' | 'websocket.subscription.removed';
  data: {
    subscriptionId: string;
    chain: string;
    mint: string;
  };
}

// ============================================================================
// CA Monitoring Events
// ============================================================================

export interface CAMonitorEvent extends BaseEvent {
  type: 'ca.monitor.added' | 'ca.monitor.removed' | 'ca.monitor.updated';
  data: {
    caId: number;
    mint: TokenAddress;
    chain: Chain;
    tokenName: string;
    tokenSymbol: string;
  };
}

export interface PriceUpdateEvent extends BaseEvent {
  type: 'price.update.received';
  data: {
    mint: TokenAddress;
    chain: Chain;
    price: number;
    marketcap: number;
    timestamp: number;
    priceChange: number;
  };
}

export interface AlertEvent extends BaseEvent {
  type:
    | 'alert.profit_target'
    | 'alert.stop_loss'
    | 'alert.ichimoku_signal'
    | 'alert.leading_span_cross';
  data: {
    caId: number;
    mint: TokenAddress;
    chain: Chain;
    tokenName: string;
    tokenSymbol: string;
    alertType: string;
    message: string;
    price: number;
    priceChange: number;
  };
}

export interface IchimokuEvent extends BaseEvent {
  type: 'ichimoku.analysis.completed' | 'ichimoku.signal.detected';
  data: {
    mint: TokenAddress;
    chain: Chain;
    ichimokuData: Record<string, unknown>;
    signals: Array<Record<string, unknown>>;
    currentPrice: number;
  };
}

// ============================================================================
// System Events
// ============================================================================

export interface SystemEvent extends BaseEvent {
  type: 'system.startup' | 'system.shutdown' | 'system.error';
  data: {
    component: string;
    message: string;
    error?: unknown;
  };
}

export interface DatabaseEvent extends BaseEvent {
  type: 'database.connected' | 'database.error' | 'database.query.executed';
  data: {
    operation: string;
    table?: string;
    duration?: number;
    error?: string;
  };
}

export interface ServiceEvent extends BaseEvent {
  type: 'service.initialized' | 'service.started' | 'service.stopped' | 'service.error';
  data: {
    serviceName: string;
    status: string;
    error?: string;
  };
}

// ============================================================================
// Performance Events
// ============================================================================

export interface PerformanceEvent extends BaseEvent {
  type: 'performance.summary.generated' | 'performance.metrics.updated';
  data: {
    activeCAs: number;
    totalAlerts: number;
    averageResponseTime: number;
    uptime: number;
  };
}

// ============================================================================
// Event Type Union
// ============================================================================

export type ApplicationEvent =
  | UserSessionEvent
  | UserCommandEvent
  | UserStrategyEvent
  | SimulationEvent
  | SimulationRunEvent
  | WebSocketEvent
  | WebSocketMessageEvent
  | WebSocketSubscriptionEvent
  | CAMonitorEvent
  | PriceUpdateEvent
  | AlertEvent
  | IchimokuEvent
  | SystemEvent
  | DatabaseEvent
  | ServiceEvent
  | PerformanceEvent;

// ============================================================================
// Event Categories
// ============================================================================

export const EVENT_CATEGORIES = {
  USER: ['user.session', 'user.command', 'user.strategy'],
  SIMULATION: ['simulation', 'simulation.run'],
  WEBSOCKET: ['websocket', 'websocket.message', 'websocket.subscription'],
  MONITORING: ['ca.monitor', 'price.update', 'alert', 'ichimoku'],
  SYSTEM: ['system', 'database', 'service'],
  PERFORMANCE: ['performance'],
} as const;

// ============================================================================
// Event Priority Levels
// ============================================================================

export enum EventPriority {
  LOW = 1,
  NORMAL = 2,
  HIGH = 3,
  CRITICAL = 4,
}

export const EVENT_PRIORITIES: Record<string, EventPriority> = {
  'system.error': EventPriority.CRITICAL,
  'websocket.error': EventPriority.HIGH,
  'alert.stop_loss': EventPriority.HIGH,
  'alert.profit_target': EventPriority.NORMAL,
  'price.update.received': EventPriority.NORMAL,
  'user.command.executed': EventPriority.NORMAL,
  'performance.summary.generated': EventPriority.LOW,
};
