"use strict";
/**
 * Service Container
 * ================
 * Dependency injection container for managing service instances and their dependencies.
 * Provides singleton management and lazy initialization.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServiceContainer = exports.ServiceStatus = void 0;
exports.getContainer = getContainer;
exports.getService = getService;
const SessionService_1 = require("../services/SessionService");
const StrategyService_1 = require("../services/StrategyService");
const SimulationService_1 = require("../services/SimulationService");
const IchimokuWorkflowService_1 = require("../services/IchimokuWorkflowService");
const CADetectionService_1 = require("../services/CADetectionService");
const RepeatSimulationHelper_1 = require("../utils/RepeatSimulationHelper");
const CommandRegistry_1 = require("../commands/CommandRegistry");
const logger_1 = require("../utils/logger");
var ServiceStatus;
(function (ServiceStatus) {
    ServiceStatus["INITIALIZING"] = "initializing";
    ServiceStatus["RUNNING"] = "running";
    ServiceStatus["STOPPING"] = "stopping";
    ServiceStatus["STOPPED"] = "stopped";
    ServiceStatus["ERROR"] = "error";
})(ServiceStatus || (exports.ServiceStatus = ServiceStatus = {}));
/**
 * Service container for dependency injection
 */
class ServiceContainer {
    constructor(config) {
        this.services = new Map();
        this.status = ServiceStatus.INITIALIZING;
        this.healthChecks = new Map();
        this.config = config;
        this.initializeServices();
        this.status = ServiceStatus.RUNNING;
    }
    /**
     * Get singleton instance of the service container
     */
    static getInstance(config) {
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
    initializeServices() {
        // Core services (no dependencies)
        this.registerService('sessionService', () => new SessionService_1.SessionService());
        this.registerService('strategyService', () => new StrategyService_1.StrategyService());
        this.registerService('simulationService', () => new SimulationService_1.SimulationService());
        // Workflow services (depend on sessionService)
        this.registerService('ichimokuWorkflowService', () => {
            const sessionService = this.getService('sessionService');
            return new IchimokuWorkflowService_1.IchimokuWorkflowService(sessionService);
        });
        this.registerService('caDetectionService', () => {
            return new CADetectionService_1.CADetectionService();
        });
        this.registerService('repeatSimulationHelper', () => {
            const sessionService = this.getService('sessionService');
            return new RepeatSimulationHelper_1.RepeatSimulationHelper(sessionService);
        });
        // Command registry (depends on all services)
        this.registerService('commandRegistry', () => {
            const sessionService = this.getService('sessionService');
            const strategyService = this.getService('strategyService');
            const simulationService = this.getService('simulationService');
            return new CommandRegistry_1.CommandRegistry(this.config.bot, sessionService, strategyService, simulationService);
        });
        logger_1.logger.info('Service container initialized with all dependencies');
    }
    /**
     * Register a service with lazy initialization
     */
    registerService(name, factory) {
        this.services.set(name, { factory, instance: null });
    }
    /**
     * Get a service instance (singleton)
     */
    getService(name) {
        const serviceEntry = this.services.get(name);
        if (!serviceEntry) {
            throw new Error(`Service '${name}' not found`);
        }
        // Lazy initialization
        if (!serviceEntry.instance) {
            serviceEntry.instance = serviceEntry.factory();
        }
        return serviceEntry.instance;
    }
    /**
     * Get all registered service names
     */
    getServiceNames() {
        return Array.from(this.services.keys());
    }
    /**
     * Check if a service is registered
     */
    hasService(name) {
        return this.services.has(name);
    }
    /**
     * Reset the container (useful for testing)
     */
    reset() {
        this.services.clear();
        ServiceContainer.instance = null;
    }
    /**
     * Get service health status (legacy method for compatibility)
     */
    getHealthStatus() {
        const status = {};
        for (const [name, serviceEntry] of this.services) {
            try {
                const instance = serviceEntry.instance || serviceEntry.factory();
                status[name] = instance !== null && instance !== undefined;
            }
            catch (error) {
                status[name] = false;
            }
        }
        return status;
    }
    /**
     * Register a health check function for a service
     */
    registerHealthCheck(serviceName, checkFn) {
        this.healthChecks.set(serviceName, checkFn);
    }
    /**
     * Get comprehensive health status for all services
     */
    async getHealthChecks() {
        const healthChecks = [];
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
                    const customCheck = await this.healthChecks.get(name)();
                    healthChecks.push(customCheck);
                }
                else {
                    healthChecks.push({
                        name,
                        status: hasInstance ? ServiceStatus.RUNNING : ServiceStatus.ERROR,
                        healthy: hasInstance,
                        lastCheck: new Date(),
                    });
                }
            }
            catch (error) {
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
    getStatus() {
        return this.status;
    }
    /**
     * Start all services (lifecycle management)
     */
    async start() {
        if (this.status === ServiceStatus.RUNNING) {
            return;
        }
        this.status = ServiceStatus.INITIALIZING;
        try {
            // Services are lazy-loaded, so initialization happens on first access
            // This method can be extended to call start() methods on services that implement lifecycle
            this.status = ServiceStatus.RUNNING;
            logger_1.logger.info('Service container started');
        }
        catch (error) {
            this.status = ServiceStatus.ERROR;
            logger_1.logger.error('Failed to start service container', error);
            throw error;
        }
    }
    /**
     * Stop all services (lifecycle management)
     */
    async stop() {
        if (this.status === ServiceStatus.STOPPED) {
            return;
        }
        this.status = ServiceStatus.STOPPING;
        try {
            // Services can implement cleanup in their own stop() methods
            // This method can be extended to call stop() methods on services
            this.status = ServiceStatus.STOPPED;
            logger_1.logger.info('Service container stopped');
        }
        catch (error) {
            this.status = ServiceStatus.ERROR;
            logger_1.logger.error('Failed to stop service container', error);
            throw error;
        }
    }
}
exports.ServiceContainer = ServiceContainer;
/**
 * Convenience function to get the service container instance
 */
function getContainer() {
    return ServiceContainer.getInstance();
}
/**
 * Convenience function to get a specific service
 */
function getService(serviceName) {
    return getContainer().getService(serviceName);
}
//# sourceMappingURL=ServiceContainer.js.map