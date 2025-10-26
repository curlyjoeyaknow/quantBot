/**
 * Service Container
 * ================
 * Dependency injection container for managing service instances and their dependencies.
 * Provides singleton management and lazy initialization.
 */

import { Telegraf } from 'telegraf';
import { SessionService } from '../services/SessionService';
import { StrategyService } from '../services/StrategyService';
import { SimulationService } from '../services/SimulationService';
import { CommandRegistry } from '../commands/CommandRegistry';

export interface ServiceContainerConfig {
  bot: Telegraf;
}

/**
 * Service container for dependency injection
 */
export class ServiceContainer {
  private static instance: ServiceContainer;
  private services: Map<string, any> = new Map();
  private config: ServiceContainerConfig;

  private constructor(config: ServiceContainerConfig) {
    this.config = config;
    this.initializeServices();
  }

  /**
   * Get singleton instance of the service container
   */
  public static getInstance(config?: ServiceContainerConfig): ServiceContainer {
    if (!ServiceContainer.instance) {
      if (!config) {
        throw new Error('ServiceContainer must be initialized with config first');
      }
      ServiceContainer.instance = new ServiceContainer(config);
    }
    return ServiceContainer.instance;
  }

  /**
   * Initialize all services in dependency order
   */
  private initializeServices(): void {
    // Core services (no dependencies)
    this.registerService('sessionService', () => new SessionService());
    this.registerService('strategyService', () => new StrategyService());
    this.registerService('simulationService', () => new SimulationService());

    // Command registry (depends on all services)
    this.registerService('commandRegistry', () => {
      const sessionService = this.getService<SessionService>('sessionService');
      const strategyService = this.getService<StrategyService>('strategyService');
      const simulationService = this.getService<SimulationService>('simulationService');
      
      return new CommandRegistry(
        this.config.bot,
        sessionService,
        strategyService,
        simulationService
      );
    });

    console.log('Service container initialized with all dependencies');
  }

  /**
   * Register a service with lazy initialization
   */
  private registerService<T>(name: string, factory: () => T): void {
    this.services.set(name, { factory, instance: null });
  }

  /**
   * Get a service instance (singleton)
   */
  public getService<T>(name: string): T {
    const serviceEntry = this.services.get(name);
    
    if (!serviceEntry) {
      throw new Error(`Service '${name}' not found`);
    }

    // Lazy initialization
    if (!serviceEntry.instance) {
      serviceEntry.instance = serviceEntry.factory();
    }

    return serviceEntry.instance as T;
  }

  /**
   * Get all registered service names
   */
  public getServiceNames(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * Check if a service is registered
   */
  public hasService(name: string): boolean {
    return this.services.has(name);
  }

  /**
   * Reset the container (useful for testing)
   */
  public reset(): void {
    this.services.clear();
    ServiceContainer.instance = null as any;
  }

  /**
   * Get service health status
   */
  public getHealthStatus(): Record<string, boolean> {
    const status: Record<string, boolean> = {};
    
    for (const [name, serviceEntry] of this.services) {
      try {
        const instance = serviceEntry.instance || serviceEntry.factory();
        status[name] = instance !== null && instance !== undefined;
      } catch (error) {
        status[name] = false;
      }
    }
    
    return status;
  }
}

/**
 * Convenience function to get the service container instance
 */
export function getContainer(): ServiceContainer {
  return ServiceContainer.getInstance();
}

/**
 * Convenience function to get a specific service
 */
export function getService<T>(serviceName: string): T {
  return getContainer().getService<T>(serviceName);
}
