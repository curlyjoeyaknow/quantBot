/**
 * Unit tests for process-telegram-python handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processTelegramPythonHandler } from '../../../../src/commands/ingestion/process-telegram-python.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import type { TelegramPipelineService, TelegramPipelineResult } from '@quantbot/ingestion';
import { PythonManifestSchema } from '@quantbot/utils';

describe('processTelegramPythonHandler', () => {
  let mockService: TelegramPipelineService;
  let mockCtx: CommandContext;

  beforeEach(() => {
    mockService = {
      runPipeline: vi.fn(),
    } as unknown as TelegramPipelineService;

    mockCtx = {
      services: {
        telegramPipeline: () => mockService,
      },
    } as unknown as CommandContext;
  });

  it('should call service with correct parameters', async () => {
    const mockManifest: TelegramPipelineResult = PythonManifestSchema.parse({
      chat_id: 'test_chat',
      chat_name: 'Test Chat',
      duckdb_file: '/path/to/output.duckdb',
      tg_rows: 100,
      caller_links_rows: 50,
      user_calls_rows: 25,
    });

    vi.mocked(mockService.runPipeline).mockResolvedValue(mockManifest);

    const args = {
      file: '/path/to/input.json',
      outputDb: '/path/to/output.duckdb',
      chatId: 'test_chat',
      rebuild: false,
      format: 'table' as const,
    };

    const result = await processTelegramPythonHandler(args, mockCtx);

    expect(mockService.runPipeline).toHaveBeenCalledWith(
      '/path/to/input.json',
      '/path/to/output.duckdb',
      'test_chat',
      false
    );
    expect(result).toEqual(mockManifest);
  });

  it('should pass rebuild flag when true', async () => {
    const mockManifest: TelegramPipelineResult = PythonManifestSchema.parse({
      chat_id: 'test_chat',
      chat_name: 'Test Chat',
      duckdb_file: '/path/to/output.duckdb',
    });

    vi.mocked(mockService.runPipeline).mockResolvedValue(mockManifest);

    const args = {
      file: '/path/to/input.json',
      outputDb: '/path/to/output.duckdb',
      chatId: 'test_chat',
      rebuild: true,
      format: 'table' as const,
    };

    await processTelegramPythonHandler(args, mockCtx);

    expect(mockService.runPipeline).toHaveBeenCalledWith(
      '/path/to/input.json',
      '/path/to/output.duckdb',
      'test_chat',
      true
    );
  });

  it('should handle optional rebuild parameter', async () => {
    const mockManifest: TelegramPipelineResult = PythonManifestSchema.parse({
      chat_id: 'test_chat',
      chat_name: 'Test Chat',
      duckdb_file: '/path/to/output.duckdb',
    });

    vi.mocked(mockService.runPipeline).mockResolvedValue(mockManifest);

    const args = {
      file: '/path/to/input.json',
      outputDb: '/path/to/output.duckdb',     
      chatId: 'test_chat',
      // rebuild not provided (undefined)
      format: 'table' as const,
    };

    await processTelegramPythonHandler(args, mockCtx);

    expect(mockService.runPipeline).toHaveBeenCalledWith(
      '/path/to/input.json',
      '/path/to/output.duckdb',
      'test_chat',
      undefined
    );
  });

  it('should propagate errors from service', async () => {
    const error = new Error('Service failed');
    vi.mocked(mockService.runPipeline).mockRejectedValue(error);

    const args = {
      file: '/path/to/input.json',
      outputDb: '/path/to/output.duckdb',
      chatId: 'test_chat',
      rebuild: false,
      format: 'table' as const,
    };

    await expect(processTelegramPythonHandler(args, mockCtx)).rejects.toThrow('Service failed');
  });
});
