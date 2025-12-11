/**
 * Service Container
 * ================
 * Dependency injection container for managing service instances and their dependencies.
 * Provides singleton management and lazy initialization.
 */
import { Telegraf } from 'telegraf';
export interface ServiceContainerConfig {
    bot: Telegraf;
}
export declare enum ServiceStatus {
    INITIALIZING = "initializing",
    RUNNING = "running",
    STOPPING = "stopping",
    STOPPED = "stopped",
    ERROR = "error"
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
export declare class ServiceContainer {
    private static instance;
    private services;
    private config;
    private status;
    private healthChecks;
    private constructor();
    /**
     * Get singleton instance of the service container
     */
    static getInstance(config?: ServiceContainerConfig): ServiceContainer;
    /**
     * Initialize all services in dependency order
     */
    private initializeServices;
    /**
     * Register a service with lazy initialization
     */
    private registerService;
    /**
     * Get a service instance (singleton)
     */
    getService<T>(name: string): T;
    /**
     * Get all registered service names
     */
    getServiceNames(): string[];
    /**
     * Check if a service is registered
     */
    hasService(name: string): boolean;
    /**
     * Reset the container (useful for testing)
     */
    reset(): void;
    /**
     * Get service health status (legacy method for compatibility)
     */
    getHealthStatus(): Record<string, boolean>;
    /**
     * Register a health check function for a service
     */
    registerHealthCheck(serviceName: string, checkFn: () => Promise<ServiceHealth>): void;
    /**
     * Get comprehensive health status for all services
     */
    getHealthChecks(): Promise<ServiceHealth[]>;
    /**
     * Get container status
     */
    getStatus(): ServiceStatus;
    /**
     * Start all services (lifecycle management)
     */
    start(): Promise<void>;
    /**
     * Stop all services (lifecycle management)
     */
    stop(): Promise<void>;
}
/**
 * Convenience function to get the service container instance
 */
export declare function getContainer(): ServiceContainer;
/**
 * Convenience function to get a specific service
 */
export declare function getService<T>(serviceName: string): T;
//# sourceMappingURL=ServiceContainer.d.ts.map