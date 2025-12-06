/**
 * Service Container
 * ================
 * Dependency injection container for managing service instances and their dependencies.
 * Provides singleton management and lazy initialization.
 */

import { Telegraf } from 'telegraf';
import { SessionService } from '@quantbot/services/SessionService';
import { StrategyService } from '@quantbot/services/StrategyService';
import { SimulationService } from '@quantbot/services/SimulationService';
import { IchimokuWorkflowService } from '@quantbot/services/IchimokuWorkflowService';
import { CADetectionService } from '@quantbot/services/CADetectionService';
import { RepeatSimulationHelper } from '../utils/RepeatSimulationHelper';
import { SessionCleanupManager } from '../utils/session-cleanup';
import { CommandRegistry } from '../commands/CommandRegistry';
import { logger } from '@quantbot/utils';

export interface ServiceContainerConfig {
  bot: Telegraf;
}

export enum ServiceStatus {
  INITIALIZING = 'initializing',
  RUNNING = 'running',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  ERROR = 'error',
}

export interface ServiceHealth {
  name: string;
  status: ServiceStatus;
  healthy: boolean;
  lastCheck?: Date;
  error?: string;
  metadata?: Record<string, any>;
}

/**
 * Service container for dependency injection
 */
export class ServiceContainer {
  private static instance: ServiceContainer;
  private services: Map<string, any> = new Map();
  private config: ServiceContainerConfig;
  private status: ServiceStatus = ServiceStatus.INITIALIZING;
  private healthChecks: Map<string, () => Promise<ServiceHealth>> = new Map();

  private constructor(config: ServiceContainerConfig) {
    this.config = config;
    this.initializeServices();
    this.status = ServiceStatus.RUNNING;
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
    
    // Workflow services (depend on sessionService)
    this.registerService('ichimokuWorkflowService', () => {
      const sessionService = this.getService<SessionService>('sessionService');
      return new IchimokuWorkflowService(sessionService);
    });
    
    this.registerService('caDetectionService', () => {
      return new CADetectionService();
    });
    
    this.registerService('repeatSimulationHelper', () => {
      const sessionService = this.getService<SessionService>('sessionService');
      return new RepeatSimulationHelper(sessionService);
    });
    
    // Session cleanup manager
    this.registerService('sessionCleanupManager', () => {
      const sessionService = this.getService<SessionService>('sessionService');
      const manager = new SessionCleanupManager(sessionService);
      manager.start();
      return manager;
    });

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

    logger.info('Service container initialized with all dependencies');
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
   * Get service health status (legacy method for compatibility)
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

  /**
   * Register a health check function for a service
   */
  public registerHealthCheck(serviceName: string, checkFn: () => Promise<ServiceHealth>): void {
    this.healthChecks.set(serviceName, checkFn);
  }

  /**
   * Get comprehensive health status for all services
   */
  public async getHealthChecks(): Promise<ServiceHealth[]> {
    const healthChecks: ServiceHealth[] = [];

    // Check container status
    healthChecks.push({
      name: 'container',
      status: this.status,
      healthy: this.status === ServiceStatus.RUNNING,
      lastCheck: new Date(),
    });

    // Check each service
    for (const [name, serviceEntry] of this.services) {
      try {
        const instance = serviceEntry.instance || serviceEntry.factory();
        const hasInstance = instance !== null && instance !== undefined;

        // Run custom health check if available
        if (this.healthChecks.has(name)) {
          const customCheck = await this.healthChecks.get(name)!();
          healthChecks.push(customCheck);
        } else {
          healthChecks.push({
            name,
            status: hasInstance ? ServiceStatus.RUNNING : ServiceStatus.ERROR,
            healthy: hasInstance,
            lastCheck: new Date(),
          });
        }
      } catch (error) {
        healthChecks.push({
          name,
          status: ServiceStatus.ERROR,
          healthy: false,
          lastCheck: new Date(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return healthChecks;
  }

  /**
   * Get container status
   */
  public getStatus(): ServiceStatus {
    return this.status;
  }

  /**
   * Start all services (lifecycle management)
   */
  public async start(): Promise<void> {
    if (this.status === ServiceStatus.RUNNING) {
      return;
    }

    this.status = ServiceStatus.INITIALIZING;
    try {
      // Services are lazy-loaded, so initialization happens on first access
      // This method can be extended to call start() methods on services that implement lifecycle
      this.status = ServiceStatus.RUNNING;
      logger.info('Service container started');
    } catch (error) {
      this.status = ServiceStatus.ERROR;
      logger.error('Failed to start service container', error as Error);
      throw error;
    }
  }

  /**
   * Stop all services (lifecycle management)
   */
  public async stop(): Promise<void> {
    if (this.status === ServiceStatus.STOPPED) {
      return;
    }

    this.status = ServiceStatus.STOPPING;
    try {
      // Services can implement cleanup in their own stop() methods
      // This method can be extended to call stop() methods on services
      this.status = ServiceStatus.STOPPED;
      logger.info('Service container stopped');
    } catch (error) {
      this.status = ServiceStatus.ERROR;
      logger.error('Failed to stop service container', error as Error);
      throw error;
    }
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
