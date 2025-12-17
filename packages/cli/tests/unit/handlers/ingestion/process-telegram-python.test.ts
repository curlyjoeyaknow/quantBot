/**
 * Unit tests for process-telegram-python handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processTelegramPythonHandler } from '../../../../src/handlers/ingestion/process-telegram-python.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import type { PythonEngine, PythonManifest } from '@quantbot/utils';

describe('processTelegramPythonHandler', () => {
  let mockEngine: PythonEngine;
  let mockCtx: CommandContext;

  beforeEach(() => {
    mockEngine = {
      runTelegramPipeline: vi.fn(),
    } as unknown as PythonEngine;

    mockCtx = {
      services: {
        pythonEngine: () => mockEngine,
      },
    } as unknown as CommandContext;
  });

  it('should call PythonEngine with correct parameters', async () => {
    const mockManifest: PythonManifest = {
      chat_id: 'test_chat',
      chat_name: 'Test Chat',
      duckdb_file: '/path/to/output.duckdb',
      tg_rows: 100,
      caller_links_rows: 50,
      user_calls_rows: 25,
    };

    vi.mocked(mockEngine.runTelegramPipeline).mockResolvedValue(mockManifest);

    const args = {
      file: '/path/to/input.json',
      outputDb: '/path/to/output.duckdb',
      chatId: 'test_chat',
      rebuild: false,
      format: 'table' as const,
    };

    const result = await processTelegramPythonHandler(args, mockCtx);

    expect(mockEngine.runTelegramPipeline).toHaveBeenCalledWith({
      inputFile: '/path/to/input.json',
      outputDb: '/path/to/output.duckdb',
      chatId: 'test_chat',
      rebuild: false,
    });
    expect(result).toEqual(mockManifest);
  });

  it('should pass rebuild flag when true', async () => {
    const mockManifest: PythonManifest = {
      chat_id: 'test_chat',
      chat_name: 'Test Chat',
      duckdb_file: '/path/to/output.duckdb',
    };

    vi.mocked(mockEngine.runTelegramPipeline).mockResolvedValue(mockManifest);

    const args = {
      file: '/path/to/input.json',
      outputDb: '/path/to/output.duckdb',
      chatId: 'test_chat',
      rebuild: true,
      format: 'table' as const,
    };

    await processTelegramPythonHandler(args, mockCtx);

    expect(mockEngine.runTelegramPipeline).toHaveBeenCalledWith({
      inputFile: '/path/to/input.json',
      outputDb: '/path/to/output.duckdb',
      chatId: 'test_chat',
      rebuild: true,
    });
  });

  it('should propagate errors from PythonEngine', async () => {
    const error = new Error('Python script failed');
    vi.mocked(mockEngine.runTelegramPipeline).mockRejectedValue(error);

    const args = {
      file: '/path/to/input.json',
      outputDb: '/path/to/output.duckdb',
      chatId: 'test_chat',
      rebuild: false,
      format: 'table' as const,
    };

    await expect(processTelegramPythonHandler(args, mockCtx)).rejects.toThrow('Python script failed');
  });
});

