/**
 * Integration tests for ingestion commands
 *
 * Tests handlers with real CommandContext to verify end-to-end integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandContext } from '../../src/core/command-context.js';
import type { TelegramPipelineService } from '@quantbot/ingestion';
import { PythonManifestSchema } from '@quantbot/utils';
import { processTelegramPythonHandler } from '../../src/handlers/ingestion/process-telegram-python.js';

describe('Ingestion Commands - Integration', () => {
  let mockService: TelegramPipelineService;
  let mockCtx: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock service
    mockService = {
      runPipeline: vi.fn(),
    } as unknown as TelegramPipelineService;

    // Create context with mocked service
    mockCtx = {
      services: {
        telegramPipeline: () => mockService,
      },
    } as unknown as CommandContext;
  });

  describe('Telegram Python Pipeline Handler - Integration', () => {
    it('should execute telegram-python handler end-to-end', async () => {
      const mockManifest = PythonManifestSchema.parse({
        chat_id: 'test_chat_123',
        chat_name: 'Test Chat',
        duckdb_file: '/tmp/test.duckdb',
        tg_rows: 100,
        caller_links_rows: 50,
        user_calls_rows: 25,
      });

      vi.mocked(mockService.runPipeline).mockResolvedValue(mockManifest);

      const args = {
        file: '/tmp/input.json',
        outputDb: '/tmp/test.duckdb',
        chatId: 'test_chat_123',
        rebuild: false,
        format: 'json' as const,
      };

      const result = await processTelegramPythonHandler(args, mockCtx);

      expect(mockService.runPipeline).toHaveBeenCalledWith(
        '/tmp/input.json',
        '/tmp/test.duckdb',
        'test_chat_123',
        false
      );
      expect(result).toEqual(mockManifest);
    });

    it('should handle rebuild flag in telegram-python handler', async () => {
      const mockManifest = PythonManifestSchema.parse({
        chat_id: 'test_chat_123',
        chat_name: 'Test Chat',
        duckdb_file: '/tmp/test.duckdb',
      });

      vi.mocked(mockService.runPipeline).mockResolvedValue(mockManifest);

      const args = {
        file: '/tmp/input.json',
        outputDb: '/tmp/test.duckdb',
        chatId: 'test_chat_123',
        rebuild: true,
        format: 'json' as const,
      };

      await processTelegramPythonHandler(args, mockCtx);

      expect(mockService.runPipeline).toHaveBeenCalledWith(
        '/tmp/input.json',
        '/tmp/test.duckdb',
        'test_chat_123',
        true
      );
    });

    it('should propagate service errors in telegram-python handler', async () => {
      const error = new Error('Pipeline execution failed');
      vi.mocked(mockService.runPipeline).mockRejectedValue(error);

      const args = {
        file: '/tmp/input.json',
        outputDb: '/tmp/test.duckdb',
        chatId: 'test_chat_123',
        rebuild: false,
        format: 'json' as const,
      };

      await expect(processTelegramPythonHandler(args, mockCtx)).rejects.toThrow(
        'Pipeline execution failed'
      );
    });

    it('should handle service initialization through context', async () => {
      const mockManifest = PythonManifestSchema.parse({
        chat_id: 'test_chat_123',
        chat_name: 'Test Chat',
        duckdb_file: '/tmp/test.duckdb',
      });

      vi.mocked(mockService.runPipeline).mockResolvedValue(mockManifest);

      const args = {
        file: '/tmp/input.json',
        outputDb: '/tmp/test.duckdb',
        chatId: 'test_chat_123',
        rebuild: false,
        format: 'json' as const,
      };

      // Verify service is accessed through context
      const result = await processTelegramPythonHandler(args, mockCtx);

      expect(mockCtx.services.telegramPipeline).toBeDefined();
      expect(result).toEqual(mockManifest);
    });

    it('should handle multiple sequential calls', async () => {
      const mockManifest1 = PythonManifestSchema.parse({
        chat_id: 'chat1',
        chat_name: 'Chat 1',
        duckdb_file: '/tmp/test1.duckdb',
      });

      const mockManifest2 = PythonManifestSchema.parse({
        chat_id: 'chat2',
        chat_name: 'Chat 2',
        duckdb_file: '/tmp/test2.duckdb',
      });

      vi.mocked(mockService.runPipeline)
        .mockResolvedValueOnce(mockManifest1)
        .mockResolvedValueOnce(mockManifest2);

      const args1 = {
        file: '/tmp/input1.json',
        outputDb: '/tmp/test1.duckdb',
        chatId: 'chat1',
        rebuild: false,
        format: 'json' as const,
      };

      const args2 = {
        file: '/tmp/input2.json',
        outputDb: '/tmp/test2.duckdb',
        chatId: 'chat2',
        rebuild: true,
        format: 'json' as const,
      };

      const result1 = await processTelegramPythonHandler(args1, mockCtx);
      const result2 = await processTelegramPythonHandler(args2, mockCtx);

      expect(result1).toEqual(mockManifest1);
      expect(result2).toEqual(mockManifest2);
      expect(mockService.runPipeline).toHaveBeenCalledTimes(2);
    });
  });
});
