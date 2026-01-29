/**
 * Unit tests for ClickHouse Query Builder
 */

import { describe, it, expect } from 'vitest';
import { buildOhlcvQuery, validateQueryParams } from '../../src/clickhouse/query-builder.js';

describe('buildOhlcvQuery', () => {
  it('should build valid ClickHouse query for 1m interval', () => {
    const query = buildOhlcvQuery({
      tokenAddress: 'ABC123',
      chain: 'solana',
      interval: '1m',
      dateRange: {
        from: '2025-05-01T00:00:00.000Z',
        to: '2025-05-01T01:00:00.000Z',
      },
    });

    expect(query).toContain("token_address = 'ABC123'");
    expect(query).toContain('ohlcv_1m');
    expect(query).toContain('ORDER BY timestamp ASC');
  });

  it('should build valid ClickHouse query for 5m interval', () => {
    const query = buildOhlcvQuery({
      tokenAddress: 'XYZ789',
      chain: 'solana',
      interval: '5m',
      dateRange: {
        from: '2025-05-01T00:00:00.000Z',
        to: '2025-05-01T01:00:00.000Z',
      },
    });

    expect(query).toContain("token_address = 'XYZ789'");
    expect(query).toContain('ohlcv_5m');
  });

  it('should throw error for unsupported interval', () => {
    expect(() =>
      buildOhlcvQuery({
        tokenAddress: 'ABC123',
        chain: 'solana',
        interval: '30s',
        dateRange: {
          from: '2025-05-01T00:00:00.000Z',
          to: '2025-05-01T01:00:00.000Z',
        },
      })
    ).toThrow('Unsupported interval: 30s');
  });
});

describe('validateQueryParams', () => {
  it('should validate valid parameters', () => {
    expect(() =>
      validateQueryParams({
        tokenAddress: 'ABC123',
        chain: 'solana',
        interval: '1m',
        dateRange: {
          from: '2025-05-01T00:00:00.000Z',
          to: '2025-05-01T01:00:00.000Z',
        },
      })
    ).not.toThrow();
  });

  it('should throw error for missing token address', () => {
    expect(() =>
      validateQueryParams({
        tokenAddress: '',
        chain: 'solana',
        interval: '1m',
        dateRange: {
          from: '2025-05-01T00:00:00.000Z',
          to: '2025-05-01T01:00:00.000Z',
        },
      })
    ).toThrow('Token address is required');
  });

  it('should throw error for missing chain', () => {
    expect(() =>
      validateQueryParams({
        tokenAddress: 'ABC123',
        chain: '',
        interval: '1m',
        dateRange: {
          from: '2025-05-01T00:00:00.000Z',
          to: '2025-05-01T01:00:00.000Z',
        },
      })
    ).toThrow('Chain is required');
  });

  it('should throw error for unsupported interval', () => {
    expect(() =>
      validateQueryParams({
        tokenAddress: 'ABC123',
        chain: 'solana',
        interval: '30s',
        dateRange: {
          from: '2025-05-01T00:00:00.000Z',
          to: '2025-05-01T01:00:00.000Z',
        },
      })
    ).toThrow('Unsupported interval: 30s');
  });

  it('should throw error for invalid from date', () => {
    expect(() =>
      validateQueryParams({
        tokenAddress: 'ABC123',
        chain: 'solana',
        interval: '1m',
        dateRange: {
          from: 'invalid-date',
          to: '2025-05-01T01:00:00.000Z',
        },
      })
    ).toThrow("Invalid 'from' date");
  });

  it('should throw error for invalid to date', () => {
    expect(() =>
      validateQueryParams({
        tokenAddress: 'ABC123',
        chain: 'solana',
        interval: '1m',
        dateRange: {
          from: '2025-05-01T00:00:00.000Z',
          to: 'invalid-date',
        },
      })
    ).toThrow("Invalid 'to' date");
  });

  it('should throw error when from date is after to date', () => {
    expect(() =>
      validateQueryParams({
        tokenAddress: 'ABC123',
        chain: 'solana',
        interval: '1m',
        dateRange: {
          from: '2025-05-01T01:00:00.000Z',
          to: '2025-05-01T00:00:00.000Z',
        },
      })
    ).toThrow("'from' date must be before 'to' date");
  });
});

