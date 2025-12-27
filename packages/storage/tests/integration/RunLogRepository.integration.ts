/**
 * Integration tests for RunLogRepository
 *
 * Tests log persistence and retrieval in ClickHouse.
 * Uses mocked ClickHouse client for testing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DateTime } from 'luxon';
import { RunLogRepository } from '../../src/clickhouse/repositories/RunLogRepository.js';

// Mock ClickHouse client
const mockExec = vi.fn();
const mockQuery = vi.fn();
const mockInsert = vi.fn();

vi.mock('../../src/clickhouse-client.js', () => ({
  getClickHouseClient: () => ({
    exec: mockExec,
    query: mockQuery,
    insert: mockInsert,
  }),
}));

describe('RunLogRepository Integration', () => {
  let repo: RunLogRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new RunLogRepository();

    // Mock schema initialization
    mockExec.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue({ json: () => Promise.resolve([]) });
    mockInsert.mockResolvedValue(undefined);
  });

  describe('initializeSchema', () => {
    it('should create run_logs table if not exists', async () => {
      await repo.initializeSchema();

      expect(mockExec).toHaveBeenCalled();
      const call = mockExec.mock.calls[0][0];
      expect(call.query).toContain('CREATE TABLE IF NOT EXISTS');
      expect(call.query).toContain('run_logs');
      expect(call.query).toContain('run_id String');
      expect(call.query).toContain('timestamp DateTime');
      expect(call.query).toContain('level LowCardinality(String)');
      expect(call.query).toContain('message String');
    });
  });

  describe('insert', () => {
    it('should insert a log entry', async () => {
      mockInsert.mockResolvedValue(undefined);

      await repo.insert({
        runId: 'test-run-1',
        level: 'info',
        message: 'Test log message',
        data: { key: 'value' },
      });

      expect(mockInsert).toHaveBeenCalled();
      const call = mockInsert.mock.calls[0][0];
      expect(call.table).toContain('run_logs');
      expect(call.values).toBeDefined();
      expect(call.values.length).toBe(1);
      expect(call.values[0].run_id).toBe('test-run-1');
      expect(call.values[0].level).toBe('info');
      expect(call.values[0].message).toBe('Test log message');
    });

    it('should handle different log levels', async () => {
      mockInsert.mockResolvedValue(undefined);

      const levels: Array<'info' | 'warn' | 'error' | 'debug'> = ['info', 'warn', 'error', 'debug'];

      for (const level of levels) {
        await repo.insert({
          runId: 'test-run-2',
          level,
          message: `${level} message`,
        });
      }

      expect(mockInsert).toHaveBeenCalledTimes(levels.length);
    });

    it('should serialize data to JSON', async () => {
      mockInsert.mockResolvedValue(undefined);

      const data = { nested: { value: 123 }, array: [1, 2, 3] };
      await repo.insert({
        runId: 'test-run-3',
        level: 'info',
        message: 'Message with data',
        data,
      });

      expect(mockInsert).toHaveBeenCalled();
      const call = mockInsert.mock.calls[0][0];
      expect(call.values[0].data_json).toBe(JSON.stringify(data));
    });
  });

  describe('getByRunId', () => {
    it('should retrieve logs for a run', async () => {
      const mockLogs = [
        {
          run_id: 'test-run-1',
          timestamp: '2024-01-01T00:00:00Z',
          level: 'info',
          message: 'Log 1',
          data_json: '{"key":"value1"}',
        },
        {
          run_id: 'test-run-1',
          timestamp: '2024-01-01T00:01:00Z',
          level: 'error',
          message: 'Log 2',
          data_json: '{"key":"value2"}',
        },
      ];

      mockQuery.mockResolvedValue({
        json: () => Promise.resolve(mockLogs),
      });

      const result = await repo.getByRunId('test-run-1', {});

      expect(mockQuery).toHaveBeenCalled();
      expect(result.logs.length).toBe(2);
      expect(result.logs[0].runId).toBe('test-run-1');
      // Logs are returned in DESC order (newest first), so first log is the error
      expect(result.logs[0].level).toBe('error');
      expect(result.logs[0].message).toBe('Log 2');
      expect(result.logs[0].data).toEqual({ key: 'value2' });
      expect(result.logs[1].level).toBe('info');
      expect(result.logs[1].message).toBe('Log 1');
    });

    it('should support cursor-based pagination', async () => {
      const mockLogs = [
        {
          run_id: 'test-run-2',
          timestamp: '2024-01-01T00:00:00Z',
          level: 'info',
          message: 'Log 1',
          data_json: '{}',
        },
      ];

      mockQuery.mockResolvedValue({
        json: () => Promise.resolve(mockLogs),
      });

      const result = await repo.getByRunId('test-run-2', {
        limit: 10,
        cursor: '2024-01-01T00:00:00Z',
      });

      expect(mockQuery).toHaveBeenCalled();
      const call = mockQuery.mock.calls[0][0];
      expect(call.query).toContain('LIMIT');
      expect(call.query).toContain('timestamp <');
      expect(call.query_params).toBeDefined();
      expect(call.query_params.cursor).toBe('2024-01-01T00:00:00Z');
    });

    it('should handle empty results', async () => {
      mockQuery.mockResolvedValue({
        json: () => Promise.resolve([]),
      });

      const result = await repo.getByRunId('non-existent', {});

      expect(result.logs).toEqual([]);
      expect(result.nextCursor).toBeNull();
    });

    it('should filter by log level', async () => {
      const mockLogs = [
        {
          run_id: 'test-run-3',
          timestamp: '2024-01-01T00:00:00Z',
          level: 'error',
          message: 'Error log',
          data_json: '{}',
        },
      ];

      mockQuery.mockResolvedValue({
        json: () => Promise.resolve(mockLogs),
      });

      const result = await repo.getByRunId('test-run-3', {
        level: 'error',
      });

      expect(mockQuery).toHaveBeenCalled();
      const call = mockQuery.mock.calls[0][0];
      expect(call.query).toContain('level =');
      expect(call.query_params.level).toBe('error');
    });
  });

  describe('error handling', () => {
    it('should handle ClickHouse connection errors gracefully', async () => {
      mockExec.mockRejectedValue(new Error('Connection failed'));

      await expect(repo.initializeSchema()).rejects.toThrow('Connection failed');
    });

    it('should handle query errors gracefully', async () => {
      mockQuery.mockRejectedValue(new Error('Query failed'));

      await expect(repo.getByRunId('test-run', {})).rejects.toThrow('Query failed');
    });
  });
});
