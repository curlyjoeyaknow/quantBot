/**
 * Health Check Tests
 * =================
 * Tests for health check functionality
 */

import { HealthCheckManager, HealthCheckResult } from '../../src/health/health-check';
import { ServiceContainer } from '../../src/container/ServiceContainer';

// Mock ServiceContainer
jest.mock('../../src/container/ServiceContainer', () => ({
  ServiceContainer: jest.fn(),
}));

// Mock clickhouse client
jest.mock('../../src/storage/clickhouse-client', () => ({
  getClickHouseClient: jest.fn().mockReturnValue({
    ping: jest.fn().mockResolvedValue(true),
  }),
}));

describe('HealthCheckManager', () => {
  let mockContainer: jest.Mocked<ServiceContainer>;
  let healthCheckManager: HealthCheckManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mockContainer = {} as any;
    healthCheckManager = new HealthCheckManager(mockContainer);
  });

  describe('Health Checks', () => {
    it('should run health checks', async () => {
      const result = await healthCheckManager.runHealthChecks();
      
      expect(result).toBeDefined();
      expect(result.status).toBeDefined();
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.services).toBeDefined();
      expect(Array.isArray(result.services)).toBe(true);
    });

    it('should include summary in health check result', async () => {
      const result = await healthCheckManager.runHealthChecks();
      
      expect(result.summary).toBeDefined();
      expect(result.summary.total).toBeGreaterThanOrEqual(0);
      expect(result.summary.healthy).toBeGreaterThanOrEqual(0);
      expect(result.summary.degraded).toBeGreaterThanOrEqual(0);
      expect(result.summary.unhealthy).toBeGreaterThanOrEqual(0);
    });

    it('should register custom health checks', async () => {
      const customCheck = jest.fn().mockResolvedValue({
        name: 'custom-service',
        status: 'running' as any,
        healthy: true,
        lastCheck: new Date(),
      });

      healthCheckManager.registerCheck('custom-service', customCheck);
      
      const result = await healthCheckManager.runHealthChecks();
      const customService = result.services.find(s => s.name === 'custom-service');
      
      expect(customService).toBeDefined();
      expect(customCheck).toHaveBeenCalled();
    });
  });
});

