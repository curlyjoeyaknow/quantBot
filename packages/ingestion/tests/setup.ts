import { vi } from 'vitest';

// Mock sqlite3 to avoid opening real databases during tests
vi.mock('sqlite3', () => ({
  Database: vi.fn(),
  verbose: () => ({ Database: vi.fn() }),
}));

// Mock @quantbot/storage to avoid loading sqlite-backed modules (caller database)
vi.mock('@quantbot/storage', async () => {
  class BaseRepo {}
  return {
    // Repositories (stub classes)
    CallsRepository: class extends BaseRepo {},
    TokensRepository: class extends BaseRepo {},
    AlertsRepository: class extends BaseRepo {},
    CallersRepository: class extends BaseRepo {},
    OhlcvRepository: class extends BaseRepo {},
    // Engine / clients
    getStorageEngine: vi.fn(),
    initClickHouse: vi.fn(),
    getClickHouseClient: vi.fn(),
    // Influx/Cache stubs used by @quantbot/ohlcv
    influxDBClient: {},
    ohlcvCache: {
      get: vi.fn(),
      set: vi.fn(),
      clear: vi.fn(),
    },
  };
});
