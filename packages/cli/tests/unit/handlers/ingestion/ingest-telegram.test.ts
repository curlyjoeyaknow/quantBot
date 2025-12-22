/**
 * Unit tests for ingestTelegramHandler
 *
 * Tests that the handler is a pure use-case function:
 * - No Commander involved
 * - No output formatting
 * - No process.exit
 * - Dependencies are injected (fake context)
 * - Pure orchestration + correct parameter translation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ingestTelegramHandler } from '../../../../src/commands/ingestion/ingest-telegram.js';

// Mock workflows
const mockIngestTelegramJson = vi.fn();
const mockCreateProductionContext = vi.fn();
const mockCreateProductionContextWithPorts = vi.fn();

vi.mock('@quantbot/workflows', () => ({
  ingestTelegramJson: (...args: unknown[]) => mockIngestTelegramJson(...args),
  createProductionContext: () => mockCreateProductionContext(),
  createProductionContextWithPorts: () => mockCreateProductionContextWithPorts(),
}));

// Mock storage repositories
vi.mock('@quantbot/storage', () => ({
  CallersRepository: class {
    constructor(_dbPath: string) {
      // Mock constructor
    }
  },
  TokenDataRepository: class {
    constructor(_dbPath: string) {
      // Mock constructor
    }
  },
}));

describe('ingestTelegramHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DUCKDB_PATH = '/tmp/test.duckdb';
    const mockContext = {
      repos: {},
      clock: { nowISO: () => new Date().toISOString() },
      ids: { newRunId: () => 'test-id' },
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
      ports: {
        clock: { nowMs: () => Date.now() },
        telemetry: {
          emitMetric: vi.fn(),
          emitEvent: vi.fn(),
          startSpan: vi.fn(),
          endSpan: vi.fn(),
          emitSpan: vi.fn(),
        },
        marketData: {} as any,
        execution: {} as any,
        state: {} as any,
        query: {} as any,
      },
    };
    mockCreateProductionContext.mockReturnValue(mockContext);
    mockCreateProductionContextWithPorts.mockResolvedValue(mockContext);
  });

  it('calls ingestTelegramJson workflow with correct parameters', async () => {
    const mockResult = {
      alertsInserted: 10,
      callsInserted: 8,
      tokensUpserted: 5,
    };

    mockIngestTelegramJson.mockResolvedValue(mockResult);

    const fakeCtx = {
      services: {},
    } as any;

    const args = {
      file: '/path/to/messages.html',
      callerName: 'Brook',
      chain: 'solana' as const,
      chatId: '12345',
      format: 'json' as const,
    };

    const result = await ingestTelegramHandler(args, fakeCtx);

    expect(mockIngestTelegramJson).toHaveBeenCalledTimes(1);
    const spec = mockIngestTelegramJson.mock.calls[0][0];
    expect(spec).toEqual({
      filePath: args.file,
      callerName: args.callerName,
      chain: args.chain,
      chatId: args.chatId,
    });

    expect(result).toEqual(mockResult);
  });

  it('handles optional chatId parameter', async () => {
    mockIngestTelegramJson.mockResolvedValue({
      alertsInserted: 5,
      callsInserted: 4,
      tokensUpserted: 3,
    });

    const fakeCtx = {
      services: {},
    } as any;

    const args = {
      file: '/path/to/messages.html',
      callerName: 'Lsy',
      chain: 'solana' as const,
      format: 'table' as const,
    };

    await ingestTelegramHandler(args, fakeCtx);

    const spec = mockIngestTelegramJson.mock.calls[0][0];
    expect(spec.chatId).toBeUndefined();
    expect(spec.filePath).toBe(args.file);
    expect(spec.callerName).toBe(args.callerName);
  });

  it('propagates workflow errors without catching them', async () => {
    const workflowError = new Error('Workflow failed: file not found');
    mockIngestTelegramJson.mockRejectedValue(workflowError);

    const fakeCtx = {
      services: {},
    } as any;

    const args = {
      file: '/path/to/messages.html',
      callerName: 'Brook',
      chain: 'solana' as const,
      format: 'json' as const,
    };

    await expect(ingestTelegramHandler(args, fakeCtx)).rejects.toThrow(
      'Workflow failed: file not found'
    );
    expect(mockIngestTelegramJson).toHaveBeenCalledTimes(1);
  });
});
