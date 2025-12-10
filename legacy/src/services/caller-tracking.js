"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.callerTracking = exports.CallerTrackingService = void 0;
const caller_database_1 = require("../storage/caller-database");
const dotenv_1 = require("dotenv");
const logger_1 = require("../utils/logger");
(0, dotenv_1.config)();
class CallerTrackingService {
    constructor() {
        this.callerDb = caller_database_1.callerDatabase;
    }
    /**
     * Initialize the caller tracking service
     */
    async initialize() {
        try {
            logger_1.logger.info('Initializing Caller Tracking Service...');
            // Database is auto-initialized in constructor
            logger_1.logger.info('Caller Tracking Service initialized');
        }
        catch (error) {
            logger_1.logger.error('Failed to initialize Caller Tracking Service', error);
            throw error;
        }
    }
    /**
     * Process and store CA drops from CSV or real-time data
     */
    async processCADrops(caDrops) {
        try {
            logger_1.logger.info('Processing CA drops', { count: caDrops.length });
            const callerAlerts = caDrops.map(drop => ({
                callerName: drop.sender,
                tokenAddress: drop.tokenAddress,
                tokenSymbol: drop.tokenSymbol,
                chain: drop.chain,
                alertTimestamp: drop.timestamp,
                alertMessage: drop.message,
                priceAtAlert: drop.priceAtAlert,
                volumeAtAlert: drop.volumeAtAlert,
                createdAt: new Date()
            }));
            const addedCount = await this.callerDb.addCallerAlertsBatch(callerAlerts);
            logger_1.logger.info('Processed CA drops', { addedCount, totalCount: caDrops.length });
            return addedCount;
        }
        catch (error) {
            logger_1.logger.error('Failed to process CA drops', error);
            throw error;
        }
    }
    /**
     * Get alerts for a specific caller
     */
    async getCallerAlerts(callerName, limit) {
        try {
            return await this.callerDb.getCallerAlerts(callerName, limit);
        }
        catch (error) {
            logger_1.logger.error('Failed to get alerts for caller', error, { callerName });
            throw error;
        }
    }
    /**
     * Get alerts for a caller within a time range
     */
    async getCallerAlertsInRange(callerName, startTime, endTime) {
        try {
            return await this.callerDb.getCallerAlertsInRange(callerName, startTime, endTime);
        }
        catch (error) {
            logger_1.logger.error('Failed to get alerts for caller in range', error, { callerName, startTime, endTime });
            throw error;
        }
    }
    /**
     * Get all callers with their statistics
     */
    async getAllCallersWithStats() {
        try {
            const callers = await this.callerDb.getAllCallers();
            const callerStats = await this.callerDb.getAllCallerStats();
            return callers.map(callerName => {
                const stats = callerStats.find(s => s.callerName === callerName);
                return {
                    callerName,
                    stats: stats || null
                };
            });
        }
        catch (error) {
            logger_1.logger.error('Failed to get callers with stats', error);
            throw error;
        }
    }
    /**
     * Get top callers by alert count
     */
    async getTopCallers(limit = 10) {
        try {
            const stats = await this.callerDb.getAllCallerStats();
            return stats.slice(0, limit).map(stat => ({
                callerName: stat.callerName,
                alertCount: stat.totalAlerts,
                uniqueTokens: stat.uniqueTokens
            }));
        }
        catch (error) {
            logger_1.logger.error('Failed to get top callers', error, { limit });
            throw error;
        }
    }
    /**
     * Get tokens called by a specific caller
     */
    async getCallerTokens(callerName) {
        try {
            return await this.callerDb.getCallerTokens(callerName);
        }
        catch (error) {
            logger_1.logger.error('Failed to get tokens for caller', error, { callerName });
            throw error;
        }
    }
    /**
     * Update caller success rate after simulation
     */
    async updateCallerSuccessRate(callerName, successRate) {
        try {
            await this.callerDb.updateCallerSuccessRate(callerName, successRate);
        }
        catch (error) {
            logger_1.logger.error('Failed to update success rate for caller', error, { callerName, successRate });
            throw error;
        }
    }
    /**
     * Get database statistics
     */
    async getDatabaseStats() {
        try {
            return await this.callerDb.getDatabaseStats();
        }
        catch (error) {
            logger_1.logger.error('Failed to get database stats', error);
            throw error;
        }
    }
    /**
     * Export caller data for analysis
     */
    async exportCallerData(callerName, format = 'json') {
        try {
            const alerts = await this.getCallerAlerts(callerName);
            if (format === 'json') {
                return JSON.stringify(alerts, null, 2);
            }
            else {
                // CSV format
                const headers = ['id', 'callerName', 'tokenAddress', 'tokenSymbol', 'chain', 'alertTimestamp', 'alertMessage', 'priceAtAlert', 'volumeAtAlert', 'createdAt'];
                const csvRows = [
                    headers.join(','),
                    ...alerts.map(alert => [
                        alert.id || '',
                        alert.callerName,
                        alert.tokenAddress,
                        alert.tokenSymbol || '',
                        alert.chain,
                        alert.alertTimestamp.toISOString(),
                        (alert.alertMessage || '').replace(/,/g, ';'), // Replace commas to avoid CSV issues
                        alert.priceAtAlert || '',
                        alert.volumeAtAlert || '',
                        alert.createdAt.toISOString()
                    ].map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
                ];
                return csvRows.join('\n');
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to export data for caller', error, { callerName, format });
            throw error;
        }
    }
    /**
     * Get simulation-ready data for a caller
     */
    async getSimulationDataForCaller(callerName, startTime, endTime) {
        try {
            let alerts;
            if (startTime && endTime) {
                alerts = await this.getCallerAlertsInRange(callerName, startTime, endTime);
            }
            else {
                alerts = await this.getCallerAlerts(callerName);
            }
            return alerts.map(alert => ({
                tokenAddress: alert.tokenAddress,
                tokenSymbol: alert.tokenSymbol || 'UNKNOWN',
                chain: alert.chain,
                alertTimestamp: alert.alertTimestamp,
                priceAtAlert: alert.priceAtAlert
            }));
        }
        catch (error) {
            logger_1.logger.error('Failed to get simulation data for caller', error, { callerName });
            throw error;
        }
    }
    /**
     * Close the service
     */
    async close() {
        await this.callerDb.close();
        logger_1.logger.info('Caller Tracking Service closed');
    }
}
exports.CallerTrackingService = CallerTrackingService;
// Export singleton instance
exports.callerTracking = new CallerTrackingService();
//# sourceMappingURL=caller-tracking.js.map