import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  UserEventHandlers,
  SimulationEventHandlers,
  WebSocketEventHandlers,
  MonitoringEventHandlers,
  SystemEventHandlers,
  EventHandlerRegistry,
} from '../src/events/EventHandlers';
import { EventBus } from '../src/events/EventBus';
import { EventFactory } from '../src/events/EventBus';
import { logger } from '../src/logger';

vi.mock('../src/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Event Handlers', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    vi.clearAllMocks();
  });

  describe('UserEventHandlers', () => {
    it('should handle user session started event', async () => {
      const event = EventFactory.createUserEvent(
        'user.session.started',
        {
          userId: 1,
          sessionData: { key: 'value' },
        },
        'test',
        1
      );

      await UserEventHandlers.handleSessionEvent(event);

      expect(logger.info).toHaveBeenCalledWith('User started new session', { userId: 1 });
    });

    it('should handle user command executed event', async () => {
      const event = EventFactory.createUserEvent(
        'user.command.executed',
        {
          userId: 1,
          command: 'test',
          success: true,
        },
        'test',
        1
      );

      await UserEventHandlers.handleCommandEvent(event);

      expect(logger.info).toHaveBeenCalledWith('User executed command successfully', {
        userId: 1,
        command: 'test',
      });
    });

    it('should handle user command failed event', async () => {
      const event = EventFactory.createUserEvent(
        'user.command.failed',
        {
          userId: 1,
          command: 'test',
          success: false,
          error: 'Test error',
        },
        'test',
        1
      );

      await UserEventHandlers.handleCommandEvent(event);

      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle user strategy saved event', async () => {
      const event = EventFactory.createUserEvent(
        'user.strategy.saved',
        {
          userId: 1,
          strategyName: 'Test Strategy',
        },
        'test',
        1
      );

      await UserEventHandlers.handleStrategyEvent(event);

      expect(logger.info).toHaveBeenCalledWith('User saved strategy', {
        userId: 1,
        strategyName: 'Test Strategy',
      });
    });
  });

  describe('SimulationEventHandlers', () => {
    it('should handle simulation started event', async () => {
      const { createTokenAddress } = await import('@quantbot/core');
      const event = EventFactory.createUserEvent(
        'simulation.started',
        {
          userId: 1,
          mint: createTokenAddress('So11111111111111111111111111111111111111112'),
          chain: 'solana',
          strategy: [],
        },
        'test',
        1
      );

      await SimulationEventHandlers.handleSimulationEvent(event);

      expect(logger.info).toHaveBeenCalled();
    });

    it('should handle simulation completed event', async () => {
      const { createTokenAddress } = await import('@quantbot/core');
      const event = EventFactory.createUserEvent(
        'simulation.completed',
        {
          userId: 1,
          mint: createTokenAddress('So11111111111111111111111111111111111111112'),
          chain: 'solana',
          strategy: [],
          result: { finalPnl: 100 },
        },
        'test',
        1
      );

      await SimulationEventHandlers.handleSimulationEvent(event);

      expect(logger.info).toHaveBeenCalled();
    });

    it('should handle simulation failed event', async () => {
      const { createTokenAddress } = await import('@quantbot/core');
      const event = EventFactory.createUserEvent(
        'simulation.failed',
        {
          userId: 1,
          mint: createTokenAddress('So11111111111111111111111111111111111111112'),
          chain: 'solana',
          strategy: [],
          error: 'Test error',
        },
        'test',
        1
      );

      await SimulationEventHandlers.handleSimulationEvent(event);

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('WebSocketEventHandlers', () => {
    it('should handle websocket connected event', async () => {
      const event = EventFactory.createSystemEvent(
        'websocket.connected',
        {
          url: 'wss://test.com',
        },
        'test'
      );

      await WebSocketEventHandlers.handleConnectionEvent(event);

      expect(logger.info).toHaveBeenCalledWith('WebSocket connected', { url: 'wss://test.com' });
    });

    it('should handle websocket error event', async () => {
      const error = new Error('Connection failed');
      const event = EventFactory.createSystemEvent(
        'websocket.error',
        {
          url: 'wss://test.com',
          error,
        },
        'test'
      );

      await WebSocketEventHandlers.handleConnectionEvent(event);

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('MonitoringEventHandlers', () => {
    it('should handle price update event', async () => {
      const { createTokenAddress } = await import('@quantbot/core');
      const event = EventFactory.createSystemEvent(
        'price.update',
        {
          mint: createTokenAddress('So11111111111111111111111111111111111111112'),
          chain: 'solana',
          price: 1.0,
          priceChange: 0.1,
        },
        'test'
      );

      await MonitoringEventHandlers.handlePriceUpdateEvent(event);

      expect(logger.debug).toHaveBeenCalled();
    });

    it('should handle alert event', async () => {
      const event = EventFactory.createSystemEvent(
        'alert.profit_target',
        {
          caId: 1,
          tokenName: 'Test Token',
          tokenSymbol: 'TEST',
          alertType: 'profit_target',
          price: 1.0,
          priceChange: 0.1,
        },
        'test'
      );

      await MonitoringEventHandlers.handleAlertEvent(event);

      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe('SystemEventHandlers', () => {
    it('should handle system startup event', async () => {
      const event = EventFactory.createSystemEvent('system.startup', {
        component: 'test',
        message: 'Starting',
      });

      await SystemEventHandlers.handleSystemEvent(event);

      expect(logger.info).toHaveBeenCalledWith('System startup', {
        component: 'test',
        message: 'Starting',
      });
    });

    it('should handle service initialized event', async () => {
      const event = EventFactory.createSystemEvent(
        'service.initialized',
        {
          serviceName: 'test-service',
          status: 'ok',
        },
        'test'
      );

      await SystemEventHandlers.handleServiceEvent(event);

      expect(logger.info).toHaveBeenCalledWith('Service initialized', {
        serviceName: 'test-service',
      });
    });
  });

  describe('EventHandlerRegistry', () => {
    it('should register all event handlers', () => {
      const registry = new EventHandlerRegistry(eventBus);
      const subscribeSpy = vi.spyOn(eventBus, 'subscribe');

      registry.registerAll();

      expect(subscribeSpy).toHaveBeenCalledTimes(27); // Total number of event subscriptions
      expect(logger.info).toHaveBeenCalledWith('All event handlers registered');
    });

    it('should unregister all event handlers', () => {
      const registry = new EventHandlerRegistry(eventBus);

      registry.unregisterAll();

      expect(logger.info).toHaveBeenCalledWith('Event handler unregistration requested');
    });
  });
});
