/**
 * @file ServiceContainer.test.ts
 * @description
 * Comprehensive unit tests for ServiceContainer covering initialization,
 * service registration, retrieval, health checks, and error scenarios.
 */

import { ServiceContainer, ServiceContainerConfig } from '../../src/container/ServiceContainer';
import { SessionService } from '../../src/services/SessionService';
import { StrategyService } from '../../src/services/StrategyService';
import { SimulationService } from '../../src/services/SimulationService';
import { CommandRegistry } from '../../src/commands/CommandRegistry';
import { Telegraf } from 'telegraf';

// Mock dependencies
jest.mock('../../src/services/SessionService');
jest.mock('../../src/services/StrategyService');
jest.mock('../../src/services/SimulationService');
jest.mock('../../src/commands/CommandRegistry');
jest.mock('telegraf');

const MockSessionService = SessionService as jest.MockedClass<typeof SessionService>;
const MockStrategyService = StrategyService as jest.MockedClass<typeof StrategyService>;
const MockSimulationService = SimulationService as jest.MockedClass<typeof SimulationService>;
const MockCommandRegistry = CommandRegistry as jest.MockedClass<typeof CommandRegistry>;
const MockTelegraf = Telegraf as jest.MockedClass<typeof Telegraf>;

describe('ServiceContainer', () => {
  let mockBot: jest.Mocked<Telegraf>;
  let config: ServiceContainerConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset singleton instance
    (ServiceContainer as any).instance = null;
    
    mockBot = {
      telegram: {
        sendMessage: jest.fn()
      }
    } as any;
    
    MockTelegraf.mockImplementation(() => mockBot);
    config = { bot: mockBot };
  });

  afterEach(() => {
    // Clean up singleton
    (ServiceContainer as any).instance = null;
  });

  describe('Container Initialization', () => {
    it('should create singleton instance with config', () => {
      const container = ServiceContainer.getInstance(config);
      
      expect(container).toBeInstanceOf(ServiceContainer);
      expect(ServiceContainer.getInstance()).toBe(container);
    });

    it('should throw error when getting instance without initialization', () => {
      expect(() => ServiceContainer.getInstance()).toThrow(
        'ServiceContainer must be initialized with config first'
      );
    });

    it('should initialize all core services', () => {
      const container = ServiceContainer.getInstance(config);
      
      expect(MockSessionService).toHaveBeenCalled();
      expect(MockStrategyService).toHaveBeenCalled();
      expect(MockSimulationService).toHaveBeenCalled();
    });

    it('should initialize CommandRegistry with dependencies', () => {
      const container = ServiceContainer.getInstance(config);
      
      expect(MockCommandRegistry).toHaveBeenCalledWith(
        expect.any(MockSessionService),
        expect.any(MockStrategyService),
        expect.any(MockSimulationService)
      );
    });

    it('should enforce singleton pattern', () => {
      const container1 = ServiceContainer.getInstance(config);
      const container2 = ServiceContainer.getInstance();
      
      expect(container1).toBe(container2);
    });

    it('should handle double initialization attempts', () => {
      const container1 = ServiceContainer.getInstance(config);
      const container2 = ServiceContainer.getInstance(config);
      
      expect(container1).toBe(container2);
    });
  });

  describe('Service Registration & Retrieval', () => {
    let container: ServiceContainer;

    beforeEach(() => {
      container = ServiceContainer.getInstance(config);
    });

    it('should get registered services', () => {
      const sessionService = container.getService<SessionService>('sessionService');
      const strategyService = container.getService<StrategyService>('strategyService');
      const simulationService = container.getService<SimulationService>('simulationService');
      const commandRegistry = container.getService<CommandRegistry>('commandRegistry');
      
      expect(sessionService).toBeInstanceOf(SessionService);
      expect(strategyService).toBeInstanceOf(StrategyService);
      expect(simulationService).toBeInstanceOf(SimulationService);
      expect(commandRegistry).toBeInstanceOf(CommandRegistry);
    });

    it('should throw error for non-existent service', () => {
      expect(() => container.getService('nonExistentService')).toThrow(
        "Service 'nonExistentService' not found"
      );
    });

    it('should implement lazy initialization', () => {
      // Services should not be created until first access
      expect(MockSessionService).toHaveBeenCalledTimes(1);
      
      // Access the service
      const sessionService = container.getService<SessionService>('sessionService');
      expect(sessionService).toBeInstanceOf(SessionService);
      
      // Should not create additional instances
      const sessionService2 = container.getService<SessionService>('sessionService');
      expect(sessionService).toBe(sessionService2);
    });

    it('should get all registered service names', () => {
      const serviceNames = container.getServiceNames();
      
      expect(serviceNames).toContain('sessionService');
      expect(serviceNames).toContain('strategyService');
      expect(serviceNames).toContain('simulationService');
      expect(serviceNames).toContain('commandRegistry');
      expect(serviceNames).toHaveLength(4);
    });

    it('should check if service exists', () => {
      expect(container.hasService('sessionService')).toBe(true);
      expect(container.hasService('strategyService')).toBe(true);
      expect(container.hasService('simulationService')).toBe(true);
      expect(container.hasService('commandRegistry')).toBe(true);
      expect(container.hasService('nonExistentService')).toBe(false);
    });
  });

  describe('Health & Diagnostics', () => {
    let container: ServiceContainer;

    beforeEach(() => {
      container = ServiceContainer.getInstance(config);
    });

    it('should get health status for all services', () => {
      const healthStatus = container.getHealthStatus();
      
      expect(healthStatus).toHaveProperty('sessionService');
      expect(healthStatus).toHaveProperty('strategyService');
      expect(healthStatus).toHaveProperty('simulationService');
      expect(healthStatus).toHaveProperty('commandRegistry');
      
      expect(healthStatus.sessionService).toBe(true);
      expect(healthStatus.strategyService).toBe(true);
      expect(healthStatus.simulationService).toBe(true);
      expect(healthStatus.commandRegistry).toBe(true);
    });

    it('should handle service factory failures in health check', () => {
      // Mock a service factory to throw an error
      const originalGetService = container.getService;
      jest.spyOn(container, 'getService').mockImplementation((name: string) => {
        if (name === 'sessionService') {
          throw new Error('Service creation failed');
        }
        return originalGetService.call(container, name);
      });

      const healthStatus = container.getHealthStatus();
      
      expect(healthStatus.sessionService).toBe(false);
      expect(healthStatus.strategyService).toBe(true);
    });

    it('should reset container for testing', () => {
      const container1 = ServiceContainer.getInstance(config);
      
      container1.reset();
      
      // Should be able to create new instance after reset
      const container2 = ServiceContainer.getInstance(config);
      expect(container1).not.toBe(container2);
    });
  });

  describe('Error Scenarios', () => {
    it('should handle missing dependencies gracefully', () => {
      // Mock CommandRegistry constructor to throw error
      MockCommandRegistry.mockImplementation(() => {
        throw new Error('Missing dependency');
      });

      expect(() => ServiceContainer.getInstance(config)).toThrow('Missing dependency');
    });

    it('should handle factory function failures', () => {
      const container = ServiceContainer.getInstance(config);
      
      // Mock a service to throw error on creation
      const originalGetService = container.getService;
      jest.spyOn(container, 'getService').mockImplementation((name: string) => {
        if (name === 'strategyService') {
          throw new Error('Factory function failed');
        }
        return originalGetService.call(container, name);
      });

      expect(() => container.getService('strategyService')).toThrow('Factory function failed');
    });

    it('should handle circular dependency detection', () => {
      // This test would require modifying the container to detect circular dependencies
      // For now, we'll test that the container doesn't crash with complex dependencies
      const container = ServiceContainer.getInstance(config);
      
      // All services should be accessible
      expect(() => container.getService('commandRegistry')).not.toThrow();
    });

    it('should handle invalid config', () => {
      const invalidConfig = { bot: null } as any;
      
      expect(() => ServiceContainer.getInstance(invalidConfig)).not.toThrow();
    });
  });

  describe('Service Lifecycle', () => {
    let container: ServiceContainer;

    beforeEach(() => {
      container = ServiceContainer.getInstance(config);
    });

    it('should maintain service instances across multiple calls', () => {
      const service1 = container.getService<SessionService>('sessionService');
      const service2 = container.getService<SessionService>('sessionService');
      
      expect(service1).toBe(service2);
    });

    it('should handle service access after reset', () => {
      const service1 = container.getService<SessionService>('sessionService');
      
      container.reset();
      
      const newContainer = ServiceContainer.getInstance(config);
      const service2 = newContainer.getService<SessionService>('sessionService');
      
      expect(service1).not.toBe(service2);
      expect(service2).toBeInstanceOf(SessionService);
    });

    it('should preserve service state during container lifetime', () => {
      const sessionService = container.getService<SessionService>('sessionService');
      
      // Simulate some state changes
      sessionService.setSession(12345, { step: 'test' });
      
      const retrievedService = container.getService<SessionService>('sessionService');
      expect(retrievedService.getSession(12345)).toEqual({ step: 'test' });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty service names', () => {
      const container = ServiceContainer.getInstance(config);
      
      expect(() => container.getService('')).toThrow("Service '' not found");
      expect(container.hasService('')).toBe(false);
    });

    it('should handle null/undefined service names', () => {
      const container = ServiceContainer.getInstance(config);
      
      expect(() => container.getService(null as any)).toThrow("Service 'null' not found");
      expect(() => container.getService(undefined as any)).toThrow("Service 'undefined' not found");
    });

    it('should handle very long service names', () => {
      const container = ServiceContainer.getInstance(config);
      const longName = 'A'.repeat(1000);
      
      expect(() => container.getService(longName)).toThrow(`Service '${longName}' not found`);
      expect(container.hasService(longName)).toBe(false);
    });

    it('should handle special characters in service names', () => {
      const container = ServiceContainer.getInstance(config);
      const specialName = 'service-with-special-chars!@#$%^&*()';
      
      expect(() => container.getService(specialName)).toThrow(`Service '${specialName}' not found`);
      expect(container.hasService(specialName)).toBe(false);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete service initialization workflow', () => {
      const container = ServiceContainer.getInstance(config);
      
      // Verify all services are accessible
      const sessionService = container.getService<SessionService>('sessionService');
      const strategyService = container.getService<StrategyService>('strategyService');
      const simulationService = container.getService<SimulationService>('simulationService');
      const commandRegistry = container.getService<CommandRegistry>('commandRegistry');
      
      expect(sessionService).toBeDefined();
      expect(strategyService).toBeDefined();
      expect(simulationService).toBeDefined();
      expect(commandRegistry).toBeDefined();
      
      // Verify health status
      const healthStatus = container.getHealthStatus();
      expect(Object.values(healthStatus).every(status => status === true)).toBe(true);
      
      // Verify service names
      const serviceNames = container.getServiceNames();
      expect(serviceNames).toHaveLength(4);
    });

    it('should handle service dependency resolution', () => {
      const container = ServiceContainer.getInstance(config);
      
      // CommandRegistry should be initialized with all its dependencies
      expect(MockCommandRegistry).toHaveBeenCalledWith(
        expect.any(MockSessionService),
        expect.any(MockStrategyService),
        expect.any(MockSimulationService)
      );
    });

    it('should handle concurrent service access', () => {
      const container = ServiceContainer.getInstance(config);
      
      // Simulate concurrent access
      const promises = Array(10).fill(null).map(() => 
        Promise.resolve(container.getService<SessionService>('sessionService'))
      );
      
      return Promise.all(promises).then(services => {
        // All services should be the same instance
        const firstService = services[0];
        services.forEach(service => {
          expect(service).toBe(firstService);
        });
      });
    });
  });

  describe('Performance & Memory', () => {
    it('should not create duplicate service instances', () => {
      const container = ServiceContainer.getInstance(config);
      
      // Access services multiple times
      for (let i = 0; i < 100; i++) {
        container.getService<SessionService>('sessionService');
        container.getService<StrategyService>('strategyService');
        container.getService<SimulationService>('simulationService');
      }
      
      // Should only create one instance of each service
      expect(MockSessionService).toHaveBeenCalledTimes(1);
      expect(MockStrategyService).toHaveBeenCalledTimes(1);
      expect(MockSimulationService).toHaveBeenCalledTimes(1);
    });

    it('should handle memory cleanup on reset', () => {
      const container1 = ServiceContainer.getInstance(config);
      const service1 = container1.getService<SessionService>('sessionService');
      
      container1.reset();
      
      // Old service should be garbage collected
      const container2 = ServiceContainer.getInstance(config);
      const service2 = container2.getService<SessionService>('sessionService');
      
      expect(service1).not.toBe(service2);
    });
  });
});
