import { callerDatabase, CallerAlert } from '@quantbot/storage';
import { config } from 'dotenv';
import { logger } from '@quantbot/utils';

config();

export interface ProcessedCADrop {
  sender: string;
  tokenAddress: string;
  tokenSymbol?: string;
  chain: string;
  timestamp: Date;
  message?: string;
  priceAtAlert?: number;
  volumeAtAlert?: number;
}

export class CallerTrackingService {
  private callerDb = callerDatabase;

  /**
   * Initialize the caller tracking service
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing Caller Tracking Service...');
      // Database is auto-initialized in constructor
      logger.info('Caller Tracking Service initialized');
    } catch (error) {
      logger.error('Failed to initialize Caller Tracking Service', error as Error);
      throw error;
    }
  }

  /**
   * Process and store CA drops from CSV or real-time data
   */
  async processCADrops(caDrops: ProcessedCADrop[]): Promise<number> {
    try {
      logger.info('Processing CA drops', { count: caDrops.length });

      const callerAlerts: CallerAlert[] = caDrops.map(drop => ({
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
      
      logger.info('Processed CA drops', { addedCount, totalCount: caDrops.length });
      return addedCount;
    } catch (error) {
      logger.error('Failed to process CA drops', error as Error);
      throw error;
    }
  }

  /**
   * Get alerts for a specific caller
   */
  async getCallerAlerts(callerName: string, limit?: number): Promise<CallerAlert[]> {
    try {
      return await this.callerDb.getCallerAlerts(callerName, limit);
    } catch (error) {
      logger.error('Failed to get alerts for caller', error as Error, { callerName });
      throw error;
    }
  }

  /**
   * Get alerts for a caller within a time range
   */
  async getCallerAlertsInRange(
    callerName: string, 
    startTime: Date, 
    endTime: Date
  ): Promise<CallerAlert[]> {
    try {
      return await this.callerDb.getCallerAlertsInRange(callerName, startTime, endTime);
    } catch (error) {
      logger.error('Failed to get alerts for caller in range', error as Error, { callerName, startTime, endTime });
      throw error;
    }
  }

  /**
   * Get all callers with their statistics
   */
  async getAllCallersWithStats(): Promise<Array<{callerName: string; stats: any}>> {
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
    } catch (error) {
      logger.error('Failed to get callers with stats', error as Error);
      throw error;
    }
  }

  /**
   * Get top callers by alert count
   */
  async getTopCallers(limit: number = 10): Promise<Array<{callerName: string, alertCount: number, uniqueTokens: number}>> {
    try {
      const stats = await this.callerDb.getAllCallerStats();
      return stats.slice(0, limit).map(stat => ({
        callerName: stat.callerName,
        alertCount: stat.totalAlerts,
        uniqueTokens: stat.uniqueTokens
      }));
    } catch (error) {
      logger.error('Failed to get top callers', error as Error, { limit });
      throw error;
    }
  }

  /**
   * Get tokens called by a specific caller
   */
  async getCallerTokens(callerName: string): Promise<Array<{tokenAddress: string, tokenSymbol: string, chain: string, alertCount: number}>> {
    try {
      return await this.callerDb.getCallerTokens(callerName);
    } catch (error) {
      logger.error('Failed to get tokens for caller', error as Error, { callerName });
      throw error;
    }
  }

  /**
   * Update caller success rate after simulation
   */
  async updateCallerSuccessRate(callerName: string, successRate: number): Promise<void> {
    try {
      await this.callerDb.updateCallerSuccessRate(callerName, successRate);
    } catch (error) {
      logger.error('Failed to update success rate for caller', error as Error, { callerName, successRate });
      throw error;
    }
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats(): Promise<{
    totalAlerts: number;
    totalCallers: number;
    totalTokens: number;
    dateRange: {start: Date, end: Date};
  }> {
    try {
      return await this.callerDb.getDatabaseStats();
    } catch (error) {
      logger.error('Failed to get database stats', error as Error);
      throw error;
    }
  }

  /**
   * Export caller data for analysis
   */
  async exportCallerData(callerName: string, format: 'json' | 'csv' = 'json'): Promise<string> {
    try {
      const alerts = await this.getCallerAlerts(callerName);
      
      if (format === 'json') {
        return JSON.stringify(alerts, null, 2);
      } else {
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
    } catch (error) {
      logger.error('Failed to export data for caller', error as Error, { callerName, format });
      throw error;
    }
  }

  /**
   * Get simulation-ready data for a caller
   */
  async getSimulationDataForCaller(
    callerName: string, 
    startTime?: Date, 
    endTime?: Date
  ): Promise<Array<{
    tokenAddress: string;
    tokenSymbol: string;
    chain: string;
    alertTimestamp: Date;
    priceAtAlert?: number;
  }>> {
    try {
      let alerts: CallerAlert[];
      
      if (startTime && endTime) {
        alerts = await this.getCallerAlertsInRange(callerName, startTime, endTime);
      } else {
        alerts = await this.getCallerAlerts(callerName);
      }

      return alerts.map(alert => ({
        tokenAddress: alert.tokenAddress,
        tokenSymbol: alert.tokenSymbol || 'UNKNOWN',
        chain: alert.chain,
        alertTimestamp: alert.alertTimestamp,
        priceAtAlert: alert.priceAtAlert
      }));
    } catch (error) {
      logger.error('Failed to get simulation data for caller', error as Error, { callerName });
      throw error;
    }
  }

  /**
   * Close the service
   */
  async close(): Promise<void> {
    await this.callerDb.close();
    logger.info('Caller Tracking Service closed');
  }
}

// Export singleton instance
export const callerTracking = new CallerTrackingService();
