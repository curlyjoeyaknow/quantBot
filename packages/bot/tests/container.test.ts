/**
 * Service Container Tests
 * =======================
 * Tests for the dependency injection container functionality
 */

import { ServiceContainer, ServiceContainerConfig } from '../../src/container/ServiceContainer';
import { Telegraf } from 'telegraf';
import { SessionService } from '../../src/services/SessionService';
import { StrategyService } from '../../src/services/StrategyService';
import { SimulationService } from '../../src/services/SimulationService';
import { CommandRegistry } from '../../src/commands/CommandRegistry';

// Mock Telegraf
jest.mock('telegraf', () => ({
  Telegraf: jest.fn().mockImplementation(() => ({
    command: jest.fn(),
    on: jest.fn(),
    launch: jest.fn(),
  })),
}));

describe('ServiceContainer', () => {
  let container: ServiceContainer;
  let mockBot: Telegraf;

  beforeEach(() => {
    mockBot = new Telegraf('test-token');
    const config: ServiceContainerConfig = { bot: mockBot };
    container = ServiceContainer.getInstance(config);
  });

  afterEach(() => {
    if (container) {
      container.reset();
    }
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = ServiceContainer.getInstance();
      const instance2 = ServiceContainer.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should throw error if not initialized', () => {
      ServiceContainer.getInstance().reset();
      expect(() => ServiceContainer.getInstance()).toThrow('ServiceContainer must be initialized with config first');
    });
  });

  describe('Service Registration and Retrieval', () => {
    it('should register and retrieve services', () => {
      const sessionService = container.getService<SessionService>('sessionService');
      expect(sessionService).toBeInstanceOf(SessionService);
    });

    it('should return singleton instances', () => {
      const service1 = container.getService<SessionService>('sessionService');
      const service2 = container.getService<SessionService>('sessionService');
      expect(service1).toBe(service2);
    });

    it('should throw error for unknown service', () => {
      expect(() => container.getService('unknownService')).toThrow("Service 'unknownService' not found");
    });
  });

  describe('Service Dependencies', () => {
    it('should inject dependencies correctly', () => {
      const commandRegistry = container.getService<CommandRegistry>('commandRegistry');
      expect(commandRegistry).toBeInstanceOf(CommandRegistry);
    });

    it('should have all required services registered', () => {
      const serviceNames = container.getServiceNames();
      expect(serviceNames).toContain('sessionService');
      expect(serviceNames).toContain('strategyService');
      expect(serviceNames).toContain('simulationService');
      expect(serviceNames).toContain('commandRegistry');
    });
  });

  describe('Health Status', () => {
    it('should return health status for all services', () => {
      const healthStatus = container.getHealthStatus();
      
      expect(healthStatus.sessionService).toBe(true);
      expect(healthStatus.strategyService).toBe(true);
      expect(healthStatus.simulationService).toBe(true);
      expect(healthStatus.commandRegistry).toBe(true);
    });
  });

  describe('Service Management', () => {
    it('should check if service exists', () => {
      expect(container.hasService('sessionService')).toBe(true);
      expect(container.hasService('unknownService')).toBe(false);
    });

    it('should reset container', () => {
      container.reset();
      expect(() => ServiceContainer.getInstance()).toThrow();
    });
  });
});
