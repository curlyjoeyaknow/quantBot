/**
 * Event Handlers
 * ==============
 * Event handlers for different components in the application.
 * Provides centralized event processing logic.
 */

import { EventHandler } from './EventBus';
import { 
  ApplicationEvent, 
  UserSessionEvent, 
  UserCommandEvent, 
  UserStrategyEvent,
  SimulationEvent,
  WebSocketEvent,
  PriceUpdateEvent,
  AlertEvent,
  SystemEvent,
  ServiceEvent
} from './EventTypes';

/**
 * User Event Handlers
 */
export class UserEventHandlers {
  /**
   * Handle user session events
   */
  public static handleSessionEvent: EventHandler<UserSessionEvent['data']> = async (event) => {
    const { userId, sessionData } = event.data;
    
    switch (event.type) {
      case 'user.session.started':
        console.log(`User ${userId} started new session`);
        break;
      case 'user.session.updated':
        console.log(`User ${userId} updated session`);
        break;
      case 'user.session.cleared':
        console.log(`User ${userId} cleared session`);
        break;
    }
  };

  /**
   * Handle user command events
   */
  public static handleCommandEvent: EventHandler<UserCommandEvent['data']> = async (event) => {
    const { userId, command, success, error } = event.data;
    
    if (success) {
      console.log(`User ${userId} executed command ${command} successfully`);
    } else {
      console.error(`User ${userId} failed to execute command ${command}: ${error}`);
    }
  };

  /**
   * Handle user strategy events
   */
  public static handleStrategyEvent: EventHandler<UserStrategyEvent['data']> = async (event) => {
    const { userId, strategyName, strategyData } = event.data;
    
    switch (event.type) {
      case 'user.strategy.saved':
        console.log(`User ${userId} saved strategy: ${strategyName}`);
        break;
      case 'user.strategy.deleted':
        console.log(`User ${userId} deleted strategy: ${strategyName}`);
        break;
      case 'user.strategy.used':
        console.log(`User ${userId} activated strategy: ${strategyName}`);
        break;
    }
  };
}

/**
 * Simulation Event Handlers
 */
export class SimulationEventHandlers {
  /**
   * Handle simulation events
   */
  public static handleSimulationEvent: EventHandler<SimulationEvent['data']> = async (event) => {
    const { userId, mint, chain, strategy, result, error } = event.data;
    
    switch (event.type) {
      case 'simulation.started':
        console.log(`Simulation started for user ${userId}, token ${mint} on ${chain}`);
        break;
      case 'simulation.completed':
        console.log(`Simulation completed for user ${userId}, PNL: ${result?.finalPnl || 'N/A'}`);
        break;
      case 'simulation.failed':
        console.error(`Simulation failed for user ${userId}: ${error}`);
        break;
    }
  };
}

/**
 * WebSocket Event Handlers
 */
export class WebSocketEventHandlers {
  /**
   * Handle WebSocket connection events
   */
  public static handleConnectionEvent: EventHandler<WebSocketEvent['data']> = async (event) => {
    const { url, reconnectAttempts, error } = event.data;
    
    switch (event.type) {
      case 'websocket.connected':
        console.log(`WebSocket connected to ${url}`);
        break;
      case 'websocket.disconnected':
        console.log(`WebSocket disconnected from ${url}`);
        break;
      case 'websocket.error':
        console.error(`WebSocket error on ${url}: ${error}`);
        break;
      case 'websocket.reconnecting':
        console.log(`WebSocket reconnecting to ${url} (attempt ${reconnectAttempts})`);
        break;
    }
  };
}

/**
 * Monitoring Event Handlers
 */
export class MonitoringEventHandlers {
  /**
   * Handle price update events
   */
  public static handlePriceUpdateEvent: EventHandler<PriceUpdateEvent['data']> = async (event) => {
    const { mint, chain, price, priceChange } = event.data;
    
    console.log(`Price update: ${mint} on ${chain} = $${price} (${(priceChange * 100).toFixed(2)}%)`);
  };

  /**
   * Handle alert events
   */
  public static handleAlertEvent: EventHandler<AlertEvent['data']> = async (event) => {
    const { caId, tokenName, tokenSymbol, alertType, price, priceChange } = event.data;
    
    console.log(`Alert sent: ${alertType} for ${tokenName} (${tokenSymbol}) at $${price} (${(priceChange * 100).toFixed(2)}%)`);
  };
}

/**
 * System Event Handlers
 */
export class SystemEventHandlers {
  /**
   * Handle system events
   */
  public static handleSystemEvent: EventHandler<SystemEvent['data']> = async (event) => {
    const { component, message, error } = event.data;
    
    switch (event.type) {
      case 'system.startup':
        console.log(`System startup: ${component} - ${message}`);
        break;
      case 'system.shutdown':
        console.log(`System shutdown: ${component} - ${message}`);
        break;
      case 'system.error':
        console.error(`System error in ${component}: ${message}`, error);
        break;
    }
  };

  /**
   * Handle service events
   */
  public static handleServiceEvent: EventHandler<ServiceEvent['data']> = async (event) => {
    const { serviceName, status, error } = event.data;
    
    switch (event.type) {
      case 'service.initialized':
        console.log(`Service initialized: ${serviceName}`);
        break;
      case 'service.started':
        console.log(`Service started: ${serviceName}`);
        break;
      case 'service.stopped':
        console.log(`Service stopped: ${serviceName}`);
        break;
      case 'service.error':
        console.error(`Service error in ${serviceName}: ${error}`);
        break;
    }
  };
}

/**
 * Event Handler Registry
 * Registers all event handlers with the event bus
 */
export class EventHandlerRegistry {
  private eventBus: any;

  constructor(eventBus: any) {
    this.eventBus = eventBus;
  }

  /**
   * Register all event handlers
   */
  public registerAll(): void {
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

    console.log('All event handlers registered');
  }

  /**
   * Unregister all event handlers
   */
  public unregisterAll(): void {
    // This would require tracking all registered handlers
    // For now, we'll just log that unregistration was requested
    console.log('Event handler unregistration requested');
  }
}
