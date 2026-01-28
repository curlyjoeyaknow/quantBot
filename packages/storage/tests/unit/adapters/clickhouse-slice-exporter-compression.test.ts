/**
 * Compression Support Tests
 *
 * Tests for compression support in ClickHouse slice exporter adapter.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClickHouseSliceExporterAdapterImpl } from '../../../src/adapters/clickhouse-slice-exporter-adapter-impl.js';
import { DuckDBClient } from '../../../src/duckdb/duckdb-client.js';
import type { SliceSpec, ParquetLayoutSpec, RunContext } from '@quantbot/core';

// Mock DuckDB client
vi.mock('../../../src/duckdb/duckdb-client.js', () => ({
  DuckDBClient: vi.fn(),
}));

// Mock dataset registry to prevent real queries and ensure correct metadata
vi.mock('../../../src/adapters/dataset-registry.js', () => {
  const mockRegistry = {
    get: vi.fn((datasetId: string) => {
      if (datasetId === 'candles_1m') {
        return {
          datasetId: 'candles_1m',
          type: 'candles' as const,
          tableName: 'ohlcv_candles',
          interval: '1m',
          defaultColumns: [
            'token_address',
            'chain',
            'timestamp',
            'interval',
            'open',
            'high',
            'low',
            'close',
            'volume',
          ],
        };
      }
      return undefined;
    }),
    getAll: vi.fn(() => []),
    isAvailable: vi.fn().mockResolvedValue(true),
  };
  return {
    datasetRegistry: mockRegistry,
  };
});

// Mock ClickHouse client
// The export code calls result.stream() if it's a function, then passes the result to readAllBytes
// Since readAllBytes is mocked to return CSV data directly, we just need to ensure
// the query returns something that can be handled
const mockQuery = vi.fn().mockResolvedValue({
  stream: vi.fn().mockResolvedValue({
    // Return an async iterable that readAllBytes can handle
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from(
        'token_address,chain,timestamp,interval,open,high,low,close,volume\nmint1,sol,1000,1m,1.0,1.1,0.9,1.05,100\n'
      );
    },
  }),
});

vi.mock('../../../src/clickhouse-client.js', () => ({
  getClickHouseClient: vi.fn(() => ({
    query: mockQuery,
  })),
}));

// Mock fs
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from('test parquet data')),
  stat: vi.fn().mockResolvedValue({ size: 100 }),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

// Mock os
vi.mock('os', () => ({
  tmpdir: () => '/tmp',
}));

// Mock readAllBytes
// This should handle whatever is passed to it (async iterator from ClickHouse stream)
// and return the CSV data that the export expects
vi.mock('../../../src/utils/readAllBytes.js', () => ({
  readAllBytes: vi.fn().mockImplementation(async (input: any) => {
    // The export passes the async iterator from result.stream() to readAllBytes
    // Our mock should return the CSV data directly
    // Make sure we have actual data rows (not just header) so it goes through the non-empty path
    return Buffer.from(
      'token_address,chain,timestamp,interval,open,high,low,close,volume\nmint1,sol,1000,1m,1.0,1.1,0.9,1.05,100\n'
    );
  }),
}));

// Mock path operations
vi.mock('path', async () => {
  const actual = await vi.importActual('path');
  return {
    ...actual,
    join: (...args: string[]) => args.join('/'),
  };
});

// Mock logger to prevent console output during tests
vi.mock('@quantbot/infra/utils', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('ClickHouse Slice Exporter - Compression', () => {
  let adapter: ClickHouseSliceExporterAdapterImpl;
  let mockExecute: ReturnType<typeof vi.fn>;
  let mockClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();

    // Create mock functions that we can track (must be created before adapter)
    mockExecute = vi.fn().mockResolvedValue(undefined);
    mockClose = vi.fn().mockResolvedValue(undefined);

    // Mock DuckDB client constructor to return an object with our tracked functions
    // DuckDBClient is used as: new DuckDBClient(':memory:')
    // So we need to mock it as a proper class constructor
    vi.mocked(DuckDBClient).mockImplementation(
      class MockDuckDBClient {
        execute = mockExecute;
        close = mockClose;
        constructor(_path: string) {
          // Constructor accepts path but we don't need it for the mock
        }
      } as any
    );

    adapter = new ClickHouseSliceExporterAdapterImpl();
  });

  it('should set zstd compression when specified in layout', async () => {
    const run: RunContext = {
      runId: 'test-run',
      createdAtIso: new Date().toISOString(),
    };

    const spec: SliceSpec = {
      dataset: 'candles_1m',
      chain: 'sol',
      timeRange: {
        startIso: '2025-01-15T00:00:00Z',
        endIso: '2025-01-15T23:59:59Z',
      },
    };

    const layout: ParquetLayoutSpec = {
      baseUri: 'file://./test',
      subdirTemplate: '{dataset}/chain={chain}/dt={yyyy}-{mm}-{dd}/run_id={runId}',
      compression: 'zstd',
      partitionKeys: ['dataset', 'chain', 'dt', 'runId'],
    };

    // Allow DuckDB operations to succeed so we can verify compression is set
    // The export will still fail later (e.g., when reading parquet file), but compression should be set
    mockExecute.mockImplementation(async (sql: string) => {
      // Allow compression setting and table creation to succeed
      if (
        sql.includes('SET parquet_compression') ||
        sql.includes('CREATE TABLE') ||
        sql.includes('COPY')
      ) {
        return undefined;
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    try {
      await adapter.exportSlice({ run, spec, layout });
    } catch {
      // Expected to fail, but compression should have been set
    }

    // Verify compression was set
    const executeCalls = mockExecute.mock.calls;
    const compressionCall = executeCalls.find((call) => {
      const sql = call[0];
      return typeof sql === 'string' && sql.includes("SET parquet_compression = 'zstd'");
    });

    expect(compressionCall).toBeDefined();
  });

  it('should set snappy compression when specified in layout', async () => {
    const run: RunContext = {
      runId: 'test-run',
      createdAtIso: new Date().toISOString(),
    };

    const spec: SliceSpec = {
      dataset: 'candles_1m',
      chain: 'sol',
      timeRange: {
        startIso: '2025-01-15T00:00:00Z',
        endIso: '2025-01-15T23:59:59Z',
      },
    };

    const layout: ParquetLayoutSpec = {
      baseUri: 'file://./test',
      subdirTemplate: '{dataset}/chain={chain}/dt={yyyy}-{mm}-{dd}/run_id={runId}',
      compression: 'snappy',
      partitionKeys: ['dataset', 'chain', 'dt', 'runId'],
    };

    // Allow DuckDB operations to succeed so we can verify compression is set
    mockExecute.mockImplementation(async (sql: string) => {
      if (
        sql.includes('SET parquet_compression') ||
        sql.includes('CREATE TABLE') ||
        sql.includes('COPY')
      ) {
        return undefined;
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    try {
      await adapter.exportSlice({ run, spec, layout });
    } catch {
      // Expected to fail, but compression should have been set
    }

    // Verify compression was set
    const executeCalls = mockExecute.mock.calls;
    const compressionCall = executeCalls.find((call) => {
      const sql = call[0];
      return typeof sql === 'string' && sql.includes("SET parquet_compression = 'snappy'");
    });
    expect(compressionCall).toBeDefined();
  });

  it('should set gzip compression when specified in layout', async () => {
    const run: RunContext = {
      runId: 'test-run',
      createdAtIso: new Date().toISOString(),
    };

    const spec: SliceSpec = {
      dataset: 'candles_1m',
      chain: 'sol',
      timeRange: {
        startIso: '2025-01-15T00:00:00Z',
        endIso: '2025-01-15T23:59:59Z',
      },
    };

    const layout: ParquetLayoutSpec = {
      baseUri: 'file://./test',
      subdirTemplate: '{dataset}/chain={chain}/dt={yyyy}-{mm}-{dd}/run_id={runId}',
      compression: 'gzip',
      partitionKeys: ['dataset', 'chain', 'dt', 'runId'],
    };

    // Allow DuckDB operations to succeed so we can verify compression is set
    mockExecute.mockImplementation(async (sql: string) => {
      if (
        sql.includes('SET parquet_compression') ||
        sql.includes('CREATE TABLE') ||
        sql.includes('COPY')
      ) {
        return undefined;
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    try {
      await adapter.exportSlice({ run, spec, layout });
    } catch {
      // Expected to fail, but compression should have been set
    }

    // Verify compression was set
    const executeCalls = mockExecute.mock.calls;
    const compressionCall = executeCalls.find((call) => {
      const sql = call[0];
      return typeof sql === 'string' && sql.includes("SET parquet_compression = 'gzip'");
    });
    expect(compressionCall).toBeDefined();
  });

  it('should not set compression when compression is none', async () => {
    const run: RunContext = {
      runId: 'test-run',
      createdAtIso: new Date().toISOString(),
    };

    const spec: SliceSpec = {
      dataset: 'candles_1m',
      chain: 'sol',
      timeRange: {
        startIso: '2025-01-15T00:00:00Z',
        endIso: '2025-01-15T23:59:59Z',
      },
    };

    const layout: ParquetLayoutSpec = {
      baseUri: 'file://./test',
      subdirTemplate: 'data/bars',
      compression: 'none',
    };

    try {
      await adapter.exportSlice({ run, spec, layout });
    } catch {
      // Expected to fail due to mocks
    }

    // Verify compression was NOT set
    const executeCalls = mockExecute.mock.calls;
    const compressionCall = executeCalls.find((call) =>
      call[0]?.includes('SET parquet_compression')
    );
    expect(compressionCall).toBeUndefined();
  });
});
