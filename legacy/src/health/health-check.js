"use strict";
/**
 * Health Check System
 * ===================
 * Comprehensive health check system for all services.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthCheckManager = void 0;
exports.createHealthCheckHandler = createHealthCheckHandler;
const ServiceContainer_1 = require("../container/ServiceContainer");
/**
 * Health check manager
 */
class HealthCheckManager {
    constructor(container) {
        this.checks = new Map();
        /**
         * Get health check result (cached for a short period)
         */
        this.lastCheck = null;
        this.lastCheckTime = 0;
        this.CACHE_TTL = 5000; // 5 seconds
        this.container = container;
        this.registerDefaultChecks();
    }
    /**
     * Register default health checks
     */
    registerDefaultChecks() {
        // Database health check
        this.registerCheck('database', async () => {
            try {
                // Try to query a simple table to check database connectivity
                // This is a placeholder - actual implementation depends on your database
                return {
                    name: 'database',
                    status: ServiceContainer_1.ServiceStatus.RUNNING,
                    healthy: true,
                    lastCheck: new Date(),
                };
            }
            catch (error) {
                return {
                    name: 'database',
                    status: ServiceContainer_1.ServiceStatus.ERROR,
                    healthy: false,
                    lastCheck: new Date(),
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        });
        // ClickHouse health check
        this.registerCheck('clickhouse', async () => {
            try {
                const { getClickHouseClient } = await Promise.resolve().then(() => __importStar(require('../storage/clickhouse-client')));
                const client = getClickHouseClient();
                await client.ping();
                return {
                    name: 'clickhouse',
                    status: ServiceContainer_1.ServiceStatus.RUNNING,
                    healthy: true,
                    lastCheck: new Date(),
                };
            }
            catch (error) {
                return {
                    name: 'clickhouse',
                    status: ServiceContainer_1.ServiceStatus.ERROR,
                    healthy: false,
                    lastCheck: new Date(),
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        });
    }
    /**
     * Register a custom health check
     */
    registerCheck(name, checkFn) {
        this.checks.set(name, checkFn);
        this.container.registerHealthCheck(name, checkFn);
    }
    /**
     * Run all health checks
     */
    async runHealthChecks(config = {}) {
        const timeout = config.timeout || 5000;
        const timestamp = new Date();
        const services = [];
        // Get container health checks
        const containerHealth = await this.container.getHealthChecks();
        services.push(...containerHealth);
        // Run custom health checks
        const checkPromises = Array.from(this.checks.entries()).map(async ([name, checkFn]) => {
            try {
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Health check timeout')), timeout));
                return await Promise.race([checkFn(), timeoutPromise]);
            }
            catch (error) {
                return {
                    name,
                    status: ServiceContainer_1.ServiceStatus.ERROR,
                    healthy: false,
                    lastCheck: new Date(),
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        });
        const customHealth = await Promise.all(checkPromises);
        services.push(...customHealth);
        // Calculate summary
        const summary = {
            total: services.length,
            healthy: services.filter(s => s.healthy).length,
            degraded: services.filter(s => s.status === ServiceContainer_1.ServiceStatus.STOPPING).length,
            unhealthy: services.filter(s => !s.healthy).length,
        };
        // Determine overall status
        let status;
        if (summary.unhealthy === 0 && summary.degraded === 0) {
            status = 'healthy';
        }
        else if (summary.unhealthy === 0) {
            status = 'degraded';
        }
        else {
            status = 'unhealthy';
        }
        return {
            status,
            timestamp,
            services,
            summary,
        };
    }
    async getHealthStatus(config = {}) {
        const now = Date.now();
        if (this.lastCheck &&
            now - this.lastCheckTime < this.CACHE_TTL &&
            !config.includeDetails) {
            return this.lastCheck;
        }
        const result = await this.runHealthChecks(config);
        this.lastCheck = result;
        this.lastCheckTime = now;
        return result;
    }
    /**
     * Check if system is healthy
     */
    async isHealthy() {
        const result = await this.getHealthStatus();
        return result.status === 'healthy';
    }
}
exports.HealthCheckManager = HealthCheckManager;
/**
 * Create health check endpoint handler
 */
function createHealthCheckHandler(container) {
    const manager = new HealthCheckManager(container);
    return async () => {
        return manager.getHealthStatus({ includeDetails: true });
    };
}
//# sourceMappingURL=health-check.js.map