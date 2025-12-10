/**
 * Event Types
 * ==========
 * Defines all event types used throughout the application.
 * Provides type safety and documentation for event-driven communication.
 */
import { BaseEvent } from './EventBus';
export interface UserSessionEvent extends BaseEvent {
    type: 'user.session.started' | 'user.session.updated' | 'user.session.cleared';
    data: {
        userId: number;
        sessionData: any;
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
        strategyData?: any;
    };
}
export interface SimulationEvent extends BaseEvent {
    type: 'simulation.started' | 'simulation.completed' | 'simulation.failed';
    data: {
        userId: number;
        mint: string;
        chain: string;
        strategy: any[];
        result?: any;
        error?: string;
    };
}
export interface SimulationRunEvent extends BaseEvent {
    type: 'simulation.run.saved' | 'simulation.run.retrieved' | 'simulation.run.repeated';
    data: {
        userId: number;
        runId: number;
        simulationData: any;
    };
}
export interface WebSocketEvent extends BaseEvent {
    type: 'websocket.connected' | 'websocket.disconnected' | 'websocket.error' | 'websocket.reconnecting';
    data: {
        url: string;
        reconnectAttempts?: number;
        error?: string;
    };
}
export interface WebSocketMessageEvent extends BaseEvent {
    type: 'websocket.message.received' | 'websocket.message.sent';
    data: {
        message: any;
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
export interface CAMonitorEvent extends BaseEvent {
    type: 'ca.monitor.added' | 'ca.monitor.removed' | 'ca.monitor.updated';
    data: {
        caId: number;
        mint: string;
        chain: string;
        tokenName: string;
        tokenSymbol: string;
    };
}
export interface PriceUpdateEvent extends BaseEvent {
    type: 'price.update.received';
    data: {
        mint: string;
        chain: string;
        price: number;
        marketcap: number;
        timestamp: number;
        priceChange: number;
    };
}
export interface AlertEvent extends BaseEvent {
    type: 'alert.profit_target' | 'alert.stop_loss' | 'alert.ichimoku_signal' | 'alert.leading_span_cross';
    data: {
        caId: number;
        mint: string;
        chain: string;
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
        mint: string;
        chain: string;
        ichimokuData: any;
        signals: any[];
        currentPrice: number;
    };
}
export interface SystemEvent extends BaseEvent {
    type: 'system.startup' | 'system.shutdown' | 'system.error';
    data: {
        component: string;
        message: string;
        error?: any;
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
export interface PerformanceEvent extends BaseEvent {
    type: 'performance.summary.generated' | 'performance.metrics.updated';
    data: {
        activeCAs: number;
        totalAlerts: number;
        averageResponseTime: number;
        uptime: number;
    };
}
export type ApplicationEvent = UserSessionEvent | UserCommandEvent | UserStrategyEvent | SimulationEvent | SimulationRunEvent | WebSocketEvent | WebSocketMessageEvent | WebSocketSubscriptionEvent | CAMonitorEvent | PriceUpdateEvent | AlertEvent | IchimokuEvent | SystemEvent | DatabaseEvent | ServiceEvent | PerformanceEvent;
export declare const EVENT_CATEGORIES: {
    readonly USER: readonly ["user.session", "user.command", "user.strategy"];
    readonly SIMULATION: readonly ["simulation", "simulation.run"];
    readonly WEBSOCKET: readonly ["websocket", "websocket.message", "websocket.subscription"];
    readonly MONITORING: readonly ["ca.monitor", "price.update", "alert", "ichimoku"];
    readonly SYSTEM: readonly ["system", "database", "service"];
    readonly PERFORMANCE: readonly ["performance"];
};
export declare enum EventPriority {
    LOW = 1,
    NORMAL = 2,
    HIGH = 3,
    CRITICAL = 4
}
export declare const EVENT_PRIORITIES: Record<string, EventPriority>;
//# sourceMappingURL=EventTypes.d.ts.map