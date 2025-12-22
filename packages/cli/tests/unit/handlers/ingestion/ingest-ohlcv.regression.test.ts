/**
 * Regression Tests for OHLCV Ingestion Handler
 *
 * CRITICAL: These tests prevent regression of bugs that were fixed:
 * 1. DuckDB path bug - handler must pass duckdbPath to context creator
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ingestOhlcvHandler } from '../../../../../src/commands/ingestion/ingest-ohlcv.js';
import type { CommandContext } from '../../../../../src/core/command-context.js';
import * as workflows from '@quantbot/workflows';

describe('ingestOhlcvHandler - Regression Tests', () => {
  let mockContext: CommandContext;
  let createOhlcvIngestionContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockContext = {
      services: {
        ohlcvIngestion: vi.fn(),
      },
    } as unknown as CommandContext;

    // Spy on createOhlcvIngestionContext to verify it receives duckdbPath
    createOhlcvIngestionContextSpy = vi.spyOn(workflows, 'createOhlcvIngestionContext');
  });

  it('CRITICAL: should pass duckdbPath to createOhlcvIngestionContext (prevents wrong path errors)', async () => {
    /**
     * REGRESSION TEST: This test would have caught the original bug.
     *
     * The original bug called createOhlcvIngestionContext() without passing duckdbPath,
     * causing StatePort to use the default path ('data/tele.duckdb') instead of the
     * path specified in the workflow spec. This caused "Cannot open file" errors.
     *
     * If this test fails, it means the handler is not passing the path correctly.
     */
    const customDuckdbPath = '/custom/path/to/calls.duckdb';

    // Mock the context creator to return a mock context
    const mockWorkflowContext = {
      ports: {
        state: {
          get: vi.fn().mockResolvedValue({ found: false }),
          set: vi.fn().mockResolvedValue({ success: true }),
        },
        marketData: {
          fetchOhlcv: vi.fn().mockResolvedValue([]),
        },
        telemetry: {
          emitEvent: vi.fn(),
        },
        clock: {
          nowMs: () => Date.now(),
        },
      },
    };

    createOhlcvIngestionContextSpy.mockResolvedValue(mockWorkflowContext as any);

    // Mock ingestOhlcv to return a result
    vi.spyOn(workflows, 'ingestOhlcv').mockResolvedValue({
      worklistGenerated: 0,
      workItemsProcessed: 0,
      workItemsSucceeded: 0,
      workItemsFailed: 0,
      workItemsSkipped: 0,
      totalCandlesFetched: 0,
      totalCandlesStored: 0,
      errors: [],
      durationMs: 0,
    });

    const args = {
      duckdb: customDuckdbPath,
      interval: '1m' as const,
      preWindow: 260,
      postWindow: 1440,
      format: 'table' as const,
    };

    await ingestOhlcvHandler(args, mockContext);

    // CRITICAL ASSERTION: Verify duckdbPath was passed to context creator
    expect(createOhlcvIngestionContextSpy).toHaveBeenCalledWith({
      duckdbPath: customDuckdbPath,
    });
  });

  it('CRITICAL: should use DUCKDB_PATH env var when --duckdb not provided', async () => {
    /**
     * REGRESSION TEST: Ensures environment variable is used as fallback.
     */
    const envDuckdbPath = '/env/path/to/calls.duckdb';
    process.env.DUCKDB_PATH = envDuckdbPath;

    const mockWorkflowContext = {
      ports: {
        state: {
          get: vi.fn().mockResolvedValue({ found: false }),
          set: vi.fn().mockResolvedValue({ success: true }),
        },
        marketData: {
          fetchOhlcv: vi.fn().mockResolvedValue([]),
        },
        telemetry: {
          emitEvent: vi.fn(),
        },
        clock: {
          nowMs: () => Date.now(),
        },
      },
    };

    createOhlcvIngestionContextSpy.mockResolvedValue(mockWorkflowContext as any);
    vi.spyOn(workflows, 'ingestOhlcv').mockResolvedValue({
      worklistGenerated: 0,
      workItemsProcessed: 0,
      workItemsSucceeded: 0,
      workItemsFailed: 0,
      workItemsSkipped: 0,
      totalCandlesFetched: 0,
      totalCandlesStored: 0,
      errors: [],
      durationMs: 0,
    });

    const args = {
      interval: '1m' as const,
      preWindow: 260,
      postWindow: 1440,
      format: 'table' as const,
    };

    await ingestOhlcvHandler(args, mockContext);

    // Verify env var path was used
    expect(createOhlcvIngestionContextSpy).toHaveBeenCalledWith({
      duckdbPath: envDuckdbPath,
    });

    // Cleanup
    delete process.env.DUCKDB_PATH;
  });
});

