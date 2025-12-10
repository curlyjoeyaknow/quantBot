/**
 * Event Handlers
 * ==============
 * Event handlers for different components in the application.
 * Provides centralized event processing logic.
 */
import { EventHandler } from './EventBus';
import { UserSessionEvent, UserCommandEvent, UserStrategyEvent, SimulationEvent, WebSocketEvent, PriceUpdateEvent, AlertEvent, SystemEvent, ServiceEvent } from './EventTypes';
/**
 * User Event Handlers
 */
export declare class UserEventHandlers {
    /**
     * Handle user session events
     */
    static handleSessionEvent: EventHandler<UserSessionEvent['data']>;
    /**
     * Handle user command events
     */
    static handleCommandEvent: EventHandler<UserCommandEvent['data']>;
    /**
     * Handle user strategy events
     */
    static handleStrategyEvent: EventHandler<UserStrategyEvent['data']>;
}
/**
 * Simulation Event Handlers
 */
export declare class SimulationEventHandlers {
    /**
     * Handle simulation events
     */
    static handleSimulationEvent: EventHandler<SimulationEvent['data']>;
}
/**
 * WebSocket Event Handlers
 */
export declare class WebSocketEventHandlers {
    /**
     * Handle WebSocket connection events
     */
    static handleConnectionEvent: EventHandler<WebSocketEvent['data']>;
}
/**
 * Monitoring Event Handlers
 */
export declare class MonitoringEventHandlers {
    /**
     * Handle price update events
     */
    static handlePriceUpdateEvent: EventHandler<PriceUpdateEvent['data']>;
    /**
     * Handle alert events
     */
    static handleAlertEvent: EventHandler<AlertEvent['data']>;
}
/**
 * System Event Handlers
 */
export declare class SystemEventHandlers {
    /**
     * Handle system events
     */
    static handleSystemEvent: EventHandler<SystemEvent['data']>;
    /**
     * Handle service events
     */
    static handleServiceEvent: EventHandler<ServiceEvent['data']>;
}
/**
 * Event Handler Registry
 * Registers all event handlers with the event bus
 */
export declare class EventHandlerRegistry {
    private eventBus;
    constructor(eventBus: any);
    /**
     * Register all event handlers
     */
    registerAll(): void;
    /**
     * Unregister all event handlers
     */
    unregisterAll(): void;
}
//# sourceMappingURL=EventHandlers.d.ts.map