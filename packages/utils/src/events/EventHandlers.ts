/**
 * Event Handlers
 * ==============
 * Event handlers for different components in the application.
 * Provides centralized event processing logic.
 */

import { EventHandler, EventBus } from './EventBus';
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
  ServiceEvent,
} from './EventTypes';
import { logger } from '../logger';

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
        logger.info('User started new session', { userId });
        break;
      case 'user.session.updated':
        logger.info('User updated session', { userId });
        break;
      case 'user.session.cleared':
        logger.info('User cleared session', { userId });
        break;
    }
  };

  /**
   * Handle user command events
   */
  public static handleCommandEvent: EventHandler<UserCommandEvent['data']> = async (event) => {
    const { userId, command, success, error } = event.data;

    if (success) {
      logger.info('User executed command successfully', { userId, command });
    } else {
      logger.error('User failed to execute command', new Error(error || 'Unknown error'), {
        userId,
        command,
      });
    }
  };

  /**
   * Handle user strategy events
   */
  public static handleStrategyEvent: EventHandler<UserStrategyEvent['data']> = async (event) => {
    const { userId, strategyName, strategyData } = event.data;

    switch (event.type) {
      case 'user.strategy.saved':
        logger.info('User saved strategy', { userId, strategyName });
        break;
      case 'user.strategy.deleted':
        logger.info('User deleted strategy', { userId, strategyName });
        break;
      case 'user.strategy.used':
        logger.info('User activated strategy', { userId, strategyName });
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
        logger.info('Simulation started', { userId, mint, chain });
        break;
      case 'simulation.completed':
        logger.info('Simulation completed', {
          userId,
          mint,
          chain,
          pnl: result?.finalPnl || 'N/A',
        });
        break;
      case 'simulation.failed':
        logger.error('Simulation failed', new Error(error || 'Unknown error'), {
          userId,
          mint,
          chain,
        });
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
        logger.info('WebSocket connected', { url });
        break;
      case 'websocket.disconnected':
        logger.info('WebSocket disconnected', { url });
        break;
      case 'websocket.error':
        logger.error('WebSocket error', error as Error, { url });
        break;
      case 'websocket.reconnecting':
        logger.info('WebSocket reconnecting', { url, attempt: reconnectAttempts });
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

    logger.debug('Price update', {
      mint,
      chain,
      price,
      priceChange: (priceChange * 100).toFixed(2),
    });
  };

  /**
   * Handle alert events
   */
  public static handleAlertEvent: EventHandler<AlertEvent['data']> = async (event) => {
    const { caId, tokenName, tokenSymbol, alertType, price, priceChange } = event.data;

    logger.info('Alert sent', {
      alertType,
      tokenName,
      tokenSymbol,
      price,
      priceChange: (priceChange * 100).toFixed(2),
    });
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
        logger.info('System startup', { component, message });
        break;
      case 'system.shutdown':
        logger.info('System shutdown', { component, message });
        break;
      case 'system.error':
        logger.error('System error', error as Error, { component, message });
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
        logger.info('Service initialized', { serviceName });
        break;
      case 'service.started':
        logger.info('Service started', { serviceName });
        break;
      case 'service.stopped':
        logger.info('Service stopped', { serviceName });
        break;
      case 'service.error':
        logger.error('Service error', error as Error, { serviceName });
        break;
    }
  };
}

/**
 * Event Handler Registry
 * Registers all event handlers with the event bus
 */
export class EventHandlerRegistry {
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
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
    this.eventBus.subscribe(
      'price.update.received',
      MonitoringEventHandlers.handlePriceUpdateEvent
    );
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

    logger.info('All event handlers registered');
  }

  /**
   * Unregister all event handlers
   */
  public unregisterAll(): void {
    // This would require tracking all registered handlers
    // For now, we'll just log that unregistration was requested
    logger.info('Event handler unregistration requested');
  }
}
