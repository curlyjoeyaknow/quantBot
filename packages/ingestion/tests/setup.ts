import { vi } from 'vitest';
import { z } from 'zod';

// Mock @quantbot/utils logger to avoid native binding issues
// Don't use importActual to avoid module resolution errors
vi.mock('@quantbot/utils', () => {
  const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  
  // Mock PythonManifestSchema (Zod schema)
  const PythonManifestSchema = z.object({
    version: z.string(),
    calls: z.array(z.any()).optional(),
    alerts: z.array(z.any()).optional(),
  });
  
  // Mock PythonEngine class
  class PythonEngine {
    async runScript() {
      return { success: true };
    }
    async runTelegramPipeline() {
      return { success: true, calls: [], alerts: [] };
    }
    async runDuckDBStorage() {
      return { success: true };
    }
    async runClickHouseEngine() {
      return { success: true };
    }
  }
  
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
    PythonEngine,
    getPythonEngine: vi.fn(() => new PythonEngine()),
    PythonManifestSchema,
    retryWithBackoff: async <T>(fn: () => Promise<T>): Promise<T> => {
      return fn();
    },
    ValidationError: class ValidationError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'ValidationError';
      }
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
