import { vi } from 'vitest';

// Mock @quantbot/utils logger to avoid native binding issues
// Don't use importActual to avoid module resolution errors
vi.mock('@quantbot/utils', () => {
  const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  return {
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
    isSolanaAddress: (s: string) => {
      if (typeof s !== 'string') return false;
      const t = s.trim();
      if (t.length < 32 || t.length > 44) return false;
      for (const ch of t) {
        if (!BASE58_ALPHABET.includes(ch)) return false;
      }
      return true;
    },
    isEvmAddress: (s: string) => {
      if (typeof s !== 'string') return false;
      const t = s.trim();
      return /^0x[a-fA-F0-9]{40}$/.test(t);
    },
    isBase58: (s: string) => {
      if (!s) return false;
      for (const ch of s) {
        if (!BASE58_ALPHABET.includes(ch)) return false;
      }
      return true;
    },
    getPythonEngine: vi.fn(),
    retryWithBackoff: async <T>(fn: () => Promise<T>): Promise<T> => {
      return fn();
    },
  };
});

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
