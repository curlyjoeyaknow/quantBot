/**
 * Health Check System
 * ===================
 * Comprehensive health check system for all services.
 */
import { ServiceContainer, ServiceHealth } from '../container/ServiceContainer';
/**
 * Health check result
 */
export interface HealthCheckResult {
    status: 'healthy' | 'degraded' | 'unhealthy';
    timestamp: Date;
    services: ServiceHealth[];
    summary: {
        total: number;
        healthy: number;
        degraded: number;
        unhealthy: number;
    };
}
/**
 * Health check configuration
 */
export interface HealthCheckConfig {
    timeout?: number;
    includeDetails?: boolean;
}
/**
 * Health check manager
 */
export declare class HealthCheckManager {
    private container;
    private checks;
    constructor(container: ServiceContainer);
    /**
     * Register default health checks
     */
    private registerDefaultChecks;
    /**
     * Register a custom health check
     */
    registerCheck(name: string, checkFn: () => Promise<ServiceHealth>): void;
    /**
     * Run all health checks
     */
    runHealthChecks(config?: HealthCheckConfig): Promise<HealthCheckResult>;
    /**
     * Get health check result (cached for a short period)
     */
    private lastCheck;
    private lastCheckTime;
    private readonly CACHE_TTL;
    getHealthStatus(config?: HealthCheckConfig): Promise<HealthCheckResult>;
    /**
     * Check if system is healthy
     */
    isHealthy(): Promise<boolean>;
}
/**
 * Create health check endpoint handler
 */
export declare function createHealthCheckHandler(container: ServiceContainer): () => Promise<HealthCheckResult>;
//# sourceMappingURL=health-check.d.ts.map