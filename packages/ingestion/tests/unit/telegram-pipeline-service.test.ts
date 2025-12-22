/**
 * Unit tests for TelegramPipelineService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramPipelineService } from '../../src/TelegramPipelineService';
import type { PythonEngine, PythonManifest } from '@quantbot/utils';
import { PythonManifestSchema } from '@quantbot/utils';

describe('TelegramPipelineService', () => {
  let mockEngine: PythonEngine;
  let service: TelegramPipelineService;

  beforeEach(() => {
    mockEngine = {
      runTelegramPipeline: vi.fn(),
    } as unknown as PythonEngine;

    service = new TelegramPipelineService(mockEngine);
  });

  it('should call PythonEngine with correct parameters', async () => {
    const mockManifest: PythonManifest = PythonManifestSchema.parse({
      chat_id: 'test_chat',
      chat_name: 'Test Chat',
      duckdb_file: '/path/to/output.duckdb',
      tg_rows: 100,
      caller_links_rows: 50,
      user_calls_rows: 25,
    });

    vi.mocked(mockEngine.runTelegramPipeline).mockResolvedValue(mockManifest);

    const result = await service.runPipeline(
      '/path/to/input.json',
      '/path/to/output.duckdb',
      'test_chat',
      false
    );

    expect(mockEngine.runTelegramPipeline).toHaveBeenCalledWith(
      {
        inputFile: '/path/to/input.json',
        outputDb: '/path/to/output.duckdb',
        chatId: 'test_chat',
        rebuild: false,
      },
      undefined
    );
    expect(result).toEqual(mockManifest);
  });

  it('should handle rebuild flag', async () => {
    const mockManifest: PythonManifest = PythonManifestSchema.parse({
      chat_id: 'test_chat',
      chat_name: 'Test Chat',
      duckdb_file: '/path/to/output.duckdb',
    });

    vi.mocked(mockEngine.runTelegramPipeline).mockResolvedValue(mockManifest);

    await service.runPipeline('/path/to/input.json', '/path/to/output.duckdb', 'test_chat', true);

    expect(mockEngine.runTelegramPipeline).toHaveBeenCalledWith(
      {
        inputFile: '/path/to/input.json',
        outputDb: '/path/to/output.duckdb',
        chatId: 'test_chat',
        rebuild: true,
      },
      undefined
    );
  });

  it('should handle optional rebuild parameter', async () => {
    const mockManifest: PythonManifest = PythonManifestSchema.parse({
      chat_id: 'test_chat',
      chat_name: 'Test Chat',
      duckdb_file: '/path/to/output.duckdb',
    });

    vi.mocked(mockEngine.runTelegramPipeline).mockResolvedValue(mockManifest);

    await service.runPipeline('/path/to/input.json', '/path/to/output.duckdb', 'test_chat');

    expect(mockEngine.runTelegramPipeline).toHaveBeenCalledWith(
      {
        inputFile: '/path/to/input.json',
        outputDb: '/path/to/output.duckdb',
        chatId: 'test_chat',
        rebuild: undefined,
      },
      undefined
    );
  });

  it('should validate output with Zod schema', async () => {
    const validManifest = {
      chat_id: 'test_chat',
      chat_name: 'Test Chat',
      duckdb_file: '/path/to/output.duckdb',
      tg_rows: 100,
    };

    vi.mocked(mockEngine.runTelegramPipeline).mockResolvedValue(validManifest);

    const result = await service.runPipeline(
      '/path/to/input.json',
      '/path/to/output.duckdb',
      'test_chat'
    );

    expect(result.chat_id).toBe('test_chat');
    expect(result.chat_name).toBe('Test Chat');
    expect(result.duckdb_file).toBe('/path/to/output.duckdb');
  });

  it('should propagate errors from PythonEngine', async () => {
    const error = new Error('Python script failed');
    vi.mocked(mockEngine.runTelegramPipeline).mockRejectedValue(error);

    await expect(
      service.runPipeline('/path/to/input.json', '/path/to/output.duckdb', 'test_chat')
    ).rejects.toThrow('Python script failed');
  });

  it('should handle invalid output from PythonEngine', async () => {
    // PythonEngine should handle validation, but test service re-validation
    const invalidOutput = {
      invalid: 'data',
      missing_required_fields: true,
    };

    vi.mocked(mockEngine.runTelegramPipeline).mockResolvedValue(invalidOutput as any);

    // Service re-validates, so this should throw
    await expect(
      service.runPipeline('/path/to/input.json', '/path/to/output.duckdb', 'test_chat')
    ).rejects.toThrow();
  });
});
