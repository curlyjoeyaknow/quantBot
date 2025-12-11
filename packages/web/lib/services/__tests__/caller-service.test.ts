import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mocks must be declared before importing the module under test
const queryMock = vi.fn();
const cacheGetMock = vi.fn();
const cacheSetMock = vi.fn();

vi.mock('../../db/postgres-manager', () => ({
  postgresManager: {
    query: (...args: unknown[]) => queryMock(...args),
  },
}));

vi.mock('../../cache', () => ({
  cache: {
    get: (...args: unknown[]) => cacheGetMock(...args),
    set: (...args: unknown[]) => cacheSetMock(...args),
  },
  cacheKeys: {},
}));

// Import after mocks so the service picks up the mocked dependencies
import { CallerService } from '../caller-service';

const service = new CallerService();

// Ensure the mocked instances are applied to the imported modules
let postgresManagerModule: any;
let cacheModule: any;

describe('CallerService', () => {
  beforeEach(async () => {
    postgresManagerModule = await import('../../db/postgres-manager');
    cacheModule = await import('../../cache');

    // Force the mocks onto the modules (extra safety in case module resolution changes)
    postgresManagerModule.postgresManager.query = (...args: unknown[]) => queryMock(...args);
    cacheModule.cache.get = (...args: unknown[]) => cacheGetMock(...args);
    cacheModule.cache.set = (...args: unknown[]) => cacheSetMock(...args);

    queryMock.mockReset();
    cacheGetMock.mockReset();
    cacheSetMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('getCallerHistory returns formatted data with pagination defaults and validation', async () => {
    // Arrange
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('COUNT(*)')) {
        return Promise.resolve({ rows: [{ total: '2' }] });
      }
      return Promise.resolve({
        rows: [
          {
            id: 1,
            caller_name: 'alice',
            token_address: 'So11111111111111111111111111111111111111112',
            token_symbol: 'SOL',
            chain: 'solana',
            alert_timestamp: '2025-01-01T00:00:00.000Z',
            price_at_alert: '0.5',
            entry_price: '0.5',
            is_duplicate: false,
          },
          {
            id: 2,
            caller_name: 'bob',
            token_address: 'So22222222222222222222222222222222222222222',
            token_symbol: null,
            chain: null,
            alert_timestamp: null,
            price_at_alert: null,
            entry_price: null,
            is_duplicate: true,
          },
        ],
      });
    });

    // Act
    const result = await service.getCallerHistory({}, 0, 2); // page < 1 and defaults

    // Assert
    expect(result.total).toBe(2);
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({
      callerName: 'alice',
      tokenSymbol: 'SOL',
      chain: 'solana',
      priceAtAlert: 0.5,
      entryPrice: 0.5,
      isDuplicate: false,
    });
    expect(result.data[1]).toMatchObject({
      callerName: 'bob',
      tokenSymbol: undefined,
      chain: 'solana', // falls back to solana when null
      priceAtAlert: undefined,
      isDuplicate: true,
    });

    // Pagination validation (page forced to 1; limit/offset appended)
    const lastQueryArgs = queryMock.mock.calls.at(-1);
    expect(lastQueryArgs?.[1]).toEqual([2, 0]);
  });

  it('getCallerHistory applies isDuplicate filtering and adjusts total', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('COUNT(*)')) {
        return Promise.resolve({ rows: [{ total: '3' }] });
      }
      return Promise.resolve({
        rows: [
          { id: 1, caller_name: 'a', token_address: 'x', chain: 'sol', alert_timestamp: '2025-01-01', is_duplicate: true },
          { id: 2, caller_name: 'b', token_address: 'y', chain: 'sol', alert_timestamp: '2025-01-02', is_duplicate: false },
          { id: 3, caller_name: 'c', token_address: 'z', chain: 'sol', alert_timestamp: '2025-01-03', is_duplicate: true },
        ],
      });
    });

    const result = await service.getCallerHistory({ isDuplicate: true }, 1, 10);

    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(2); // adjusted to filtered length
    expect(result.data.every((r) => r.isDuplicate)).toBe(true);
  });

  it('getRecentAlerts returns cached result when available', async () => {
    const cached = { data: [{ id: 1 }], total: 1 };
    cacheGetMock.mockReturnValue(cached);

    const result = await service.getRecentAlerts();

    expect(result).toBe(cached);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('getRecentAlerts queries and caches when no cache', async () => {
    cacheGetMock.mockReturnValue(undefined);
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('COUNT(*)')) {
        return Promise.resolve({ rows: [{ total: '1' }] });
      }
      return Promise.resolve({
        rows: [
          {
            id: 1,
            caller_name: 'alice',
            token_address: 'mint',
            token_symbol: 'TKN',
            chain: 'solana',
            alert_timestamp: '2025-01-01T00:00:00.000Z',
            price_at_alert: '0.1',
            entry_price: '0.1',
            is_duplicate: false,
          },
        ],
      });
    });

    const result = await service.getRecentAlerts(1, 5, 30);

    expect(result.total).toBe(1);
    expect(result.data[0]).toMatchObject({
      callerName: 'alice',
      tokenSymbol: 'TKN',
      priceAtAlert: 0.1,
      isDuplicate: false,
    });
    expect(cacheSetMock).toHaveBeenCalled();
    // Ensure parameterized daysBack was used (passed as first param array)
    expect(queryMock.mock.calls[0][1]).toEqual([30]);
  });

  it('getCallerStatsFormatted returns cached when present', async () => {
    const cached = { callers: [], totals: { total_calls: 0, total_callers: 0, total_tokens: 0, earliest_call: null, latest_call: null } };
    cacheGetMock.mockReturnValue(cached);

    const result = await service.getCallerStatsFormatted();

    expect(result).toBe(cached);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('getCallerStatsFormatted formats query results and caches them', async () => {
    cacheGetMock.mockReturnValue(undefined);
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('GROUP BY')) {
        return Promise.resolve({
          rows: [
            {
              name: 'alice',
              total_calls: '3',
              unique_tokens: '2',
              first_call: '2025-01-01T00:00:00.000Z',
              last_call: '2025-02-01T00:00:00.000Z',
              avg_price: '0.5',
            },
          ],
        });
      }
      return Promise.resolve({
        rows: [
          {
            total_calls: '3',
            total_callers: '1',
            total_tokens: '2',
            earliest_call: '2025-01-01T00:00:00.000Z',
            latest_call: '2025-02-01T00:00:00.000Z',
          },
        ],
      });
    });

    const result = await service.getCallerStatsFormatted();

    expect(result.callers[0]).toMatchObject({
      name: 'alice',
      totalCalls: 3,
      uniqueTokens: 2,
      avgPrice: 0.5,
    });
    expect(result.totals.total_calls).toBe(3);
    expect(cacheSetMock).toHaveBeenCalled();
  });

  it('getAllCallers uses cache and orders handles', async () => {
    cacheGetMock.mockReturnValue(undefined);
    queryMock.mockResolvedValue({ rows: [{ handle: 'b' }, { handle: 'a' }] });

    const result = await service.getAllCallers();

    expect(result).toEqual(['b', 'a']);
    expect(cacheSetMock).toHaveBeenCalled();
  });
});

