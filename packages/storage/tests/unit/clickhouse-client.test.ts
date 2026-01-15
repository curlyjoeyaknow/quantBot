/**
 * Tests for clickhouse-client.ts
 *
 * Tests cover:
 * - Client initialization
 * - Connection management
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let getClickHouseClient: any;
let initClickHouse: any;
let closeClickHouse: any;
let mockCreateClient: any;

// Mock @clickhouse/client
const mockClient = {
  exec: vi.fn(),
  insert: vi.fn(),
  query: vi.fn(),
  close: vi.fn(),
};

// Create mock function - must be defined before vi.mock
const mockCreateClientFn = vi.fn(() => mockClient);

vi.mock('@clickhouse/client', () => {
  return {
    createClient: mockCreateClientFn,
  };
});

vi.mock('@quantbot/utils', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  getClickHouseDatabaseName: () => 'quantbot',
}));

describe('ClickHouse Client', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockClient.exec.mockReset();
    mockClient.insert.mockReset();
    mockClient.query.mockReset();
    mockClient.close.mockReset();
    mockCreateClientFn.mockClear();
    // Reset singleton client before each test
    if (closeClickHouse) {
      try {
        await closeClickHouse();
      } catch (e) {
        // Ignore errors
      }
    }
  });

  const loadModule = async () => {
    const module = await import('../../src/clickhouse-client');
    getClickHouseClient = module.getClickHouseClient;
    initClickHouse = module.initClickHouse;
    closeClickHouse = module.closeClickHouse;
    // Use the mock function directly
    mockCreateClient = mockCreateClientFn;
  };

  afterEach(async () => {
    // Reset singleton client between tests
    if (closeClickHouse) {
      try {
        await closeClickHouse();
      } catch (e) {
        // Ignore errors
      }
    }
    vi.clearAllMocks();
  });

  describe('getClickHouseClient', () => {
    it('should create a new client on first call', async () => {
      await loadModule();
      mockCreateClientFn.mockClear();

      const client = getClickHouseClient();

      expect(mockCreateClientFn).toHaveBeenCalled();
      expect(client).toBe(mockClient);
    });

    it('should reuse existing client on subsequent calls', async () => {
      await loadModule();
      mockCreateClientFn.mockClear();

      const client1 = getClickHouseClient();
      const client2 = getClickHouseClient();

      expect(mockCreateClientFn).toHaveBeenCalledTimes(1);
      expect(client1).toBe(client2);
    });

    it('should use environment variables for configuration', async () => {
      vi.stubEnv('CLICKHOUSE_HOST', 'test-host');
      vi.stubEnv('CLICKHOUSE_PORT', '9000');
      vi.stubEnv('CLICKHOUSE_USER', 'test-user');
      vi.stubEnv('CLICKHOUSE_PASSWORD', 'test-password');
      vi.stubEnv('CLICKHOUSE_DATABASE', 'test-db');

      // Reset modules to reload with new env vars
      vi.resetModules();
      await loadModule();
      mockCreateClientFn.mockClear();
      getClickHouseClient();

      expect(mockCreateClientFn).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'http://test-host:9000',
          username: 'test-user',
          password: 'test-password',
          database: 'test-db',
        })
      );

      vi.unstubAllEnvs();
      vi.resetModules();
      await loadModule();
    });
  });

  describe('initClickHouse', () => {
    it('should initialize database and tables', async () => {
      await loadModule();
      mockClient.exec.mockResolvedValue(undefined);
      mockClient.close.mockResolvedValue(undefined);
      mockCreateClientFn.mockClear();

      await initClickHouse();

      // initClickHouse creates a temporary client, so createClient should be called
      expect(mockCreateClientFn).toHaveBeenCalled();
      expect(mockClient.exec).toHaveBeenCalled();
    });

    it('should handle initialization errors', async () => {
      await loadModule();
      mockClient.exec.mockRejectedValue(new Error('Connection failed'));
      mockClient.close.mockResolvedValue(undefined);
      mockCreateClientFn.mockClear();

      await expect(initClickHouse()).rejects.toThrow('Connection failed');

      // Should still create a temporary client
      expect(mockCreateClientFn).toHaveBeenCalled();
    });
  });
});
