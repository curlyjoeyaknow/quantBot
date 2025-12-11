"use strict";
/**
 * Event Handlers
 * ==============
 * Event handlers for different components in the application.
 * Provides centralized event processing logic.
 */
var _a, _b, _c, _d, _e;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventHandlerRegistry = exports.SystemEventHandlers = exports.MonitoringEventHandlers = exports.WebSocketEventHandlers = exports.SimulationEventHandlers = exports.UserEventHandlers = void 0;
const logger_1 = require("../utils/logger");
/**
 * User Event Handlers
 */
class UserEventHandlers {
}
exports.UserEventHandlers = UserEventHandlers;
_a = UserEventHandlers;
/**
 * Handle user session events
 */
UserEventHandlers.handleSessionEvent = async (event) => {
    const { userId, sessionData } = event.data;
    switch (event.type) {
        case 'user.session.started':
            logger_1.logger.info('User started new session', { userId });
            break;
        case 'user.session.updated':
            logger_1.logger.info('User updated session', { userId });
            break;
        case 'user.session.cleared':
            logger_1.logger.info('User cleared session', { userId });
            break;
    }
};
/**
 * Handle user command events
 */
UserEventHandlers.handleCommandEvent = async (event) => {
    const { userId, command, success, error } = event.data;
    if (success) {
        logger_1.logger.info('User executed command successfully', { userId, command });
    }
    else {
        logger_1.logger.error('User failed to execute command', new Error(error || 'Unknown error'), { userId, command });
    }
};
/**
 * Handle user strategy events
 */
UserEventHandlers.handleStrategyEvent = async (event) => {
    const { userId, strategyName, strategyData } = event.data;
    switch (event.type) {
        case 'user.strategy.saved':
            logger_1.logger.info('User saved strategy', { userId, strategyName });
            break;
        case 'user.strategy.deleted':
            logger_1.logger.info('User deleted strategy', { userId, strategyName });
            break;
        case 'user.strategy.used':
            logger_1.logger.info('User activated strategy', { userId, strategyName });
            break;
    }
};
/**
 * Simulation Event Handlers
 */
class SimulationEventHandlers {
}
exports.SimulationEventHandlers = SimulationEventHandlers;
_b = SimulationEventHandlers;
/**
 * Handle simulation events
 */
SimulationEventHandlers.handleSimulationEvent = async (event) => {
    const { userId, mint, chain, strategy, result, error } = event.data;
    switch (event.type) {
        case 'simulation.started':
            logger_1.logger.info('Simulation started', { userId, mint, chain });
            break;
        case 'simulation.completed':
            logger_1.logger.info('Simulation completed', { userId, mint, chain, pnl: result?.finalPnl || 'N/A' });
            break;
        case 'simulation.failed':
            logger_1.logger.error('Simulation failed', new Error(error || 'Unknown error'), { userId, mint, chain });
            break;
    }
};
/**
 * WebSocket Event Handlers
 */
class WebSocketEventHandlers {
}
exports.WebSocketEventHandlers = WebSocketEventHandlers;
_c = WebSocketEventHandlers;
/**
 * Handle WebSocket connection events
 */
WebSocketEventHandlers.handleConnectionEvent = async (event) => {
    const { url, reconnectAttempts, error } = event.data;
    switch (event.type) {
        case 'websocket.connected':
            logger_1.logger.info('WebSocket connected', { url });
            break;
        case 'websocket.disconnected':
            logger_1.logger.info('WebSocket disconnected', { url });
            break;
        case 'websocket.error':
            logger_1.logger.error('WebSocket error', error, { url });
            break;
        case 'websocket.reconnecting':
            logger_1.logger.info('WebSocket reconnecting', { url, attempt: reconnectAttempts });
            break;
    }
};
/**
 * Monitoring Event Handlers
 */
class MonitoringEventHandlers {
}
exports.MonitoringEventHandlers = MonitoringEventHandlers;
_d = MonitoringEventHandlers;
/**
 * Handle price update events
 */
MonitoringEventHandlers.handlePriceUpdateEvent = async (event) => {
    const { mint, chain, price, priceChange } = event.data;
    logger_1.logger.debug('Price update', { mint, chain, price, priceChange: (priceChange * 100).toFixed(2) });
};
/**
 * Handle alert events
 */
MonitoringEventHandlers.handleAlertEvent = async (event) => {
    const { caId, tokenName, tokenSymbol, alertType, price, priceChange } = event.data;
    logger_1.logger.info('Alert sent', { alertType, tokenName, tokenSymbol, price, priceChange: (priceChange * 100).toFixed(2) });
};
/**
 * System Event Handlers
 */
class SystemEventHandlers {
}
exports.SystemEventHandlers = SystemEventHandlers;
_e = SystemEventHandlers;
/**
 * Handle system events
 */
SystemEventHandlers.handleSystemEvent = async (event) => {
    const { component, message, error } = event.data;
    switch (event.type) {
        case 'system.startup':
            logger_1.logger.info('System startup', { component, message });
            break;
        case 'system.shutdown':
            logger_1.logger.info('System shutdown', { component, message });
            break;
        case 'system.error':
            logger_1.logger.error('System error', error, { component, message });
            break;
    }
};
/**
 * Handle service events
 */
SystemEventHandlers.handleServiceEvent = async (event) => {
    const { serviceName, status, error } = event.data;
    switch (event.type) {
        case 'service.initialized':
            logger_1.logger.info('Service initialized', { serviceName });
            break;
        case 'service.started':
            logger_1.logger.info('Service started', { serviceName });
            break;
        case 'service.stopped':
            logger_1.logger.info('Service stopped', { serviceName });
            break;
        case 'service.error':
            logger_1.logger.error('Service error', error, { serviceName });
            break;
    }
};
/**
 * Event Handler Registry
 * Registers all event handlers with the event bus
 */
class EventHandlerRegistry {
    constructor(eventBus) {
        this.eventBus = eventBus;
    }
    /**
     * Register all event handlers
     */
    registerAll() {
        // User events
        this.eventBus.subscribe('user.session.started', UserEventHandlers.handleSessionEvent);
        this.eventBus.subscribe('user.session.updated', UserEventHandlers.handleSessionEvent);
        this.eventBus.subscribe('user.session.cleared', UserEventHandlers.handleSessionEvent);
        this.eventBus.subscribe('user.command.executed', UserEventHandlers.handleCommandEvent);
        this.eventBus.subscribe('user.command.failed', UserEventHandlers.handleCommandEvent);
        this.eventBus.subscribe('user.strategy.saved', UserEventHandlers.handleStrategyEvent);
        this.eventBus.subscribe('user.strategy.deleted', UserEventHandlers.handleStrategyEvent);
        this.eventBus.subscribe('user.strategy.used', UserEventHandlers.handleStrategyEvent);
        // Simulation events
        this.eventBus.subscribe('simulation.started', SimulationEventHandlers.handleSimulationEvent);
        this.eventBus.subscribe('simulation.completed', SimulationEventHandlers.handleSimulationEvent);
        this.eventBus.subscribe('simulation.failed', SimulationEventHandlers.handleSimulationEvent);
        // WebSocket events
        this.eventBus.subscribe('websocket.connected', WebSocketEventHandlers.handleConnectionEvent);
        this.eventBus.subscribe('websocket.disconnected', WebSocketEventHandlers.handleConnectionEvent);
        this.eventBus.subscribe('websocket.error', WebSocketEventHandlers.handleConnectionEvent);
        this.eventBus.subscribe('websocket.reconnecting', WebSocketEventHandlers.handleConnectionEvent);
        // Monitoring events
        this.eventBus.subscribe('price.update.received', MonitoringEventHandlers.handlePriceUpdateEvent);
        this.eventBus.subscribe('alert.profit_target', MonitoringEventHandlers.handleAlertEvent);
        this.eventBus.subscribe('alert.stop_loss', MonitoringEventHandlers.handleAlertEvent);
        this.eventBus.subscribe('alert.ichimoku_signal', MonitoringEventHandlers.handleAlertEvent);
        this.eventBus.subscribe('alert.leading_span_cross', MonitoringEventHandlers.handleAlertEvent);
        // System events
        this.eventBus.subscribe('system.startup', SystemEventHandlers.handleSystemEvent);
        this.eventBus.subscribe('system.shutdown', SystemEventHandlers.handleSystemEvent);
        this.eventBus.subscribe('system.error', SystemEventHandlers.handleSystemEvent);
        this.eventBus.subscribe('service.initialized', SystemEventHandlers.handleServiceEvent);
        this.eventBus.subscribe('service.started', SystemEventHandlers.handleServiceEvent);
        this.eventBus.subscribe('service.stopped', SystemEventHandlers.handleServiceEvent);
        this.eventBus.subscribe('service.error', SystemEventHandlers.handleServiceEvent);
        logger_1.logger.info('All event handlers registered');
    }
    /**
     * Unregister all event handlers
     */
    unregisterAll() {
        // This would require tracking all registered handlers
        // For now, we'll just log that unregistration was requested
        logger_1.logger.info('Event handler unregistration requested');
    }
}
exports.EventHandlerRegistry = EventHandlerRegistry;
//# sourceMappingURL=EventHandlers.js.map