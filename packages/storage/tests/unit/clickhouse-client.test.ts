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

vi.mock('@quantbot/utils', async () => {
  const actual = await vi.importActual<typeof import('@quantbot/utils')>('@quantbot/utils');
  return {
    ...actual,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

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
      const originalHost = process.env.CLICKHOUSE_HOST;
      const originalPort = process.env.CLICKHOUSE_PORT;
      const originalUser = process.env.CLICKHOUSE_USER;
      const originalPassword = process.env.CLICKHOUSE_PASSWORD;
      const originalDatabase = process.env.CLICKHOUSE_DATABASE;

      try {
        process.env.CLICKHOUSE_HOST = 'test-host';
        process.env.CLICKHOUSE_PORT = '9000';
        process.env.CLICKHOUSE_USER = 'test-user';
        process.env.CLICKHOUSE_PASSWORD = 'test-password';
        process.env.CLICKHOUSE_DATABASE = 'test-db';

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
      } finally {
        // Restore original values
        if (originalHost) process.env.CLICKHOUSE_HOST = originalHost;
        else delete process.env.CLICKHOUSE_HOST;
        if (originalPort) process.env.CLICKHOUSE_PORT = originalPort;
        else delete process.env.CLICKHOUSE_PORT;
        if (originalUser) process.env.CLICKHOUSE_USER = originalUser;
        else delete process.env.CLICKHOUSE_USER;
        if (originalPassword) process.env.CLICKHOUSE_PASSWORD = originalPassword;
        else delete process.env.CLICKHOUSE_PASSWORD;
        if (originalDatabase) process.env.CLICKHOUSE_DATABASE = originalDatabase;
        else delete process.env.CLICKHOUSE_DATABASE;
        // Reload module with original env vars
        vi.resetModules();
        await loadModule();
      }
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
