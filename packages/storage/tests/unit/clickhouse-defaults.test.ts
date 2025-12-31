/**
 * Tests for ClickHouse default configuration consistency
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockClient = {
  exec: vi.fn(),
  insert: vi.fn(),
  query: vi.fn(),
  close: vi.fn(),
};

const mockCreateClientFn = vi.fn(() => mockClient);

vi.mock('@clickhouse/client', () => ({
  createClient: mockCreateClientFn,
}));

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

describe('ClickHouse defaults', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockClient.exec.mockReset();
    mockClient.insert.mockReset();
    mockClient.query.mockReset();
    mockClient.close.mockReset();
    mockCreateClientFn.mockClear();
    delete process.env.CLICKHOUSE_HOST;
    delete process.env.CLICKHOUSE_PORT;
    delete process.env.CLICKHOUSE_USER;
    delete process.env.CLICKHOUSE_PASSWORD;
    delete process.env.CLICKHOUSE_DATABASE;
    vi.resetModules();
  });

  afterEach(async () => {
    const module = await import('../../src/clickhouse-client');
    await module.closeClickHouse();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value;
    }
  });

  it('uses consistent defaults for client and repositories', async () => {
    const { getClickHouseDatabaseName } = await import('@quantbot/utils');
    const database = getClickHouseDatabaseName();
    const { getClickHouseClient } = await import('../../src/clickhouse-client');
    const { OhlcvRepository } = await import('../../src/clickhouse/repositories/OhlcvRepository');

    getClickHouseClient();

    expect(mockCreateClientFn).toHaveBeenCalledWith(
      expect.objectContaining({
        database,
      })
    );

    const repo = new OhlcvRepository();
    await repo.upsertCandles('token-address', 'solana', '1m', [
      {
        timestamp: 1700000000,
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1,
      },
    ]);

    expect(mockClient.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        table: `${database}.ohlcv_candles`,
      })
    );
  });
});
