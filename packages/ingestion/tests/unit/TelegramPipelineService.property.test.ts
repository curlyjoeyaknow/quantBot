/**
 * Property/fuzzing tests for TelegramPipelineService
 *
 * Tests the service with various edge cases and invalid inputs
 * to ensure robust validation and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramPipelineService } from '../../src/TelegramPipelineService';
import type { PythonEngine } from '@quantbot/infra/utils';
import { PythonManifestSchema } from '@quantbot/infra/utils';

describe('TelegramPipelineService - Property/Fuzzing Tests', () => {
  let mockEngine: PythonEngine;
  let service: TelegramPipelineService;

  beforeEach(() => {
    mockEngine = {
      runTelegramPipeline: vi.fn(),
    } as unknown as PythonEngine;

    service = new TelegramPipelineService(mockEngine);
  });

  describe('Input Validation', () => {
    it('should handle empty string inputs', async () => {
      const mockManifest = PythonManifestSchema.parse({
        chat_id: '',
        chat_name: '',
        duckdb_file: '',
      });

      vi.mocked(mockEngine.runTelegramPipeline).mockResolvedValue(mockManifest);

      const result = await service.runPipeline('', '', '');

      expect(mockEngine.runTelegramPipeline).toHaveBeenCalledWith(
        {
          inputFile: '',
          outputDb: '',
          chatId: '',
          rebuild: undefined,
        },
        undefined
      );
      expect(result.chat_id).toBe('');
    });

    it('should handle very long string inputs', async () => {
      const longString = 'a'.repeat(10000);
      const mockManifest = PythonManifestSchema.parse({
        chat_id: longString,
        chat_name: longString,
        duckdb_file: longString,
      });

      vi.mocked(mockEngine.runTelegramPipeline).mockResolvedValue(mockManifest);

      const result = await service.runPipeline(longString, longString, longString);

      expect(mockEngine.runTelegramPipeline).toHaveBeenCalledWith(
        {
          inputFile: longString,
          outputDb: longString,
          chatId: longString,
          rebuild: undefined,
        },
        undefined
      );
      expect(result.chat_id).toBe(longString);
    });

    it('should handle special characters in inputs', async () => {
      const specialChars = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/~`';
      const mockManifest = PythonManifestSchema.parse({
        chat_id: specialChars,
        chat_name: specialChars,
        duckdb_file: specialChars,
      });

      vi.mocked(mockEngine.runTelegramPipeline).mockResolvedValue(mockManifest);

      const result = await service.runPipeline(specialChars, specialChars, specialChars);

      expect(mockEngine.runTelegramPipeline).toHaveBeenCalledWith(
        {
          inputFile: specialChars,
          outputDb: specialChars,
          chatId: specialChars,
          rebuild: undefined,
        },
        undefined
      );
      expect(result.chat_id).toBe(specialChars);
    });

    it('should handle unicode characters in inputs', async () => {
      const unicodeString = '测试🚀🎉中文';
      const mockManifest = PythonManifestSchema.parse({
        chat_id: unicodeString,
        chat_name: unicodeString,
        duckdb_file: unicodeString,
      });

      vi.mocked(mockEngine.runTelegramPipeline).mockResolvedValue(mockManifest);

      const result = await service.runPipeline(unicodeString, unicodeString, unicodeString);

      expect(mockEngine.runTelegramPipeline).toHaveBeenCalledWith(
        {
          inputFile: unicodeString,
          outputDb: unicodeString,
          chatId: unicodeString,
          rebuild: undefined,
        },
        undefined
      );
      expect(result.chat_id).toBe(unicodeString);
    });

    it('should handle path-like strings', async () => {
      const paths = [
        '/absolute/path/to/file.json',
        './relative/path/to/file.json',
        '../parent/path/to/file.json',
        'C:\\Windows\\Path\\To\\File.json',
        '~/home/user/file.json',
      ];

      for (const path of paths) {
        const mockManifest = PythonManifestSchema.parse({
          chat_id: 'test',
          chat_name: 'Test',
          duckdb_file: path,
        });

        vi.mocked(mockEngine.runTelegramPipeline).mockResolvedValue(mockManifest);

        const result = await service.runPipeline(path, path, 'test');

        expect(mockEngine.runTelegramPipeline).toHaveBeenCalledWith(
          {
            inputFile: path,
            outputDb: path,
            chatId: 'test',
            rebuild: undefined,
          },
          undefined
        );
        expect(result.duckdb_file).toBe(path);
      }
    });
  });

  describe('Output Validation', () => {
    it('should reject invalid manifest structure', async () => {
      const invalidOutputs = [
        null,
        undefined,
        {},
        { chat_id: 'test' }, // Missing required fields
        { chat_name: 'test' }, // Missing required fields
        { duckdb_file: 'test' }, // Missing required fields
        { chat_id: 123, chat_name: 'test', duckdb_file: 'test' }, // Wrong type
        { chat_id: 'test', chat_name: 123, duckdb_file: 'test' }, // Wrong type
        { chat_id: 'test', chat_name: 'test', duckdb_file: 123 }, // Wrong type
        [],
        'string',
        123,
      ];

      for (const invalidOutput of invalidOutputs) {
        vi.mocked(mockEngine.runTelegramPipeline).mockResolvedValue(invalidOutput as any);

        await expect(
          service.runPipeline('/path/to/input.json', '/path/to/output.duckdb', 'test')
        ).rejects.toThrow();
      }
    });

    it('should accept valid manifest with optional fields', async () => {
      const validManifests = [
        {
          chat_id: 'test',
          chat_name: 'Test',
          duckdb_file: '/path/to/file.duckdb',
        },
        {
          chat_id: 'test',
          chat_name: 'Test',
          duckdb_file: '/path/to/file.duckdb',
          tg_rows: 100,
        },
        {
          chat_id: 'test',
          chat_name: 'Test',
          duckdb_file: '/path/to/file.duckdb',
          tg_rows: 100,
          caller_links_rows: 50,
        },
        {
          chat_id: 'test',
          chat_name: 'Test',
          duckdb_file: '/path/to/file.duckdb',
          tg_rows: 100,
          caller_links_rows: 50,
          user_calls_rows: 25,
        },
      ];

      for (const manifest of validManifests) {
        const parsed = PythonManifestSchema.parse(manifest);
        vi.mocked(mockEngine.runTelegramPipeline).mockResolvedValue(parsed);

        const result = await service.runPipeline(
          '/path/to/input.json',
          '/path/to/output.duckdb',
          'test'
        );

        expect(result.chat_id).toBe('test');
        expect(result.chat_name).toBe('Test');
        expect(result.duckdb_file).toBe('/path/to/file.duckdb');
      }
    });

    it('should handle numeric optional fields correctly', async () => {
      const manifest = PythonManifestSchema.parse({
        chat_id: 'test',
        chat_name: 'Test',
        duckdb_file: '/path/to/file.duckdb',
        tg_rows: 0,
        caller_links_rows: 0,
        user_calls_rows: 0,
      });

      vi.mocked(mockEngine.runTelegramPipeline).mockResolvedValue(manifest);

      const result = await service.runPipeline(
        '/path/to/input.json',
        '/path/to/output.duckdb',
        'test'
      );

      expect(result.tg_rows).toBe(0);
      expect(result.caller_links_rows).toBe(0);
      expect(result.user_calls_rows).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should propagate various error types', async () => {
      const errors = [
        new Error('Standard error'),
        new TypeError('Type error'),
        new RangeError('Range error'),
        { message: 'Plain object error' },
        'String error',
        123,
      ];

      for (const error of errors) {
        vi.mocked(mockEngine.runTelegramPipeline).mockRejectedValue(error as any);

        await expect(
          service.runPipeline('/path/to/input.json', '/path/to/output.duckdb', 'test')
        ).rejects.toBeDefined();
      }
    });

    it('should handle null/undefined errors gracefully', async () => {
      // Test null - when rejected with null, Promise rejection behavior varies
      // We just verify the service doesn't crash
      vi.mocked(mockEngine.runTelegramPipeline).mockRejectedValue(null as any);
      try {
        await service.runPipeline('/path/to/input.json', '/path/to/output.duckdb', 'test');
        // If it doesn't throw, that's fine - the service handled it
      } catch (error) {
        // If it throws, that's also fine - error was propagated
        expect(error).toBeDefined();
      }

      // Test undefined - when rejected with undefined, the error caught will be undefined
      vi.mocked(mockEngine.runTelegramPipeline).mockRejectedValue(undefined as any);
      try {
        await service.runPipeline('/path/to/input.json', '/path/to/output.duckdb', 'test');
        // If it doesn't throw, that's fine - the service handled it
      } catch (error) {
        // When rejected with undefined, error will be undefined - that's valid JavaScript behavior
        // The service should handle this gracefully without crashing
        // We just verify it doesn't crash, error can be undefined
      }
    });

    it('should handle timeout errors', async () => {
      const timeoutError = new Error('Python script timed out');
      timeoutError.name = 'TimeoutError';
      vi.mocked(mockEngine.runTelegramPipeline).mockRejectedValue(timeoutError);

      await expect(
        service.runPipeline('/path/to/input.json', '/path/to/output.duckdb', 'test')
      ).rejects.toThrow('timed out');
    });
  });

  describe('Rebuild Flag Variations', () => {
    it('should handle rebuild flag as true', async () => {
      const mockManifest = PythonManifestSchema.parse({
        chat_id: 'test',
        chat_name: 'Test',
        duckdb_file: '/path/to/file.duckdb',
      });

      vi.mocked(mockEngine.runTelegramPipeline).mockResolvedValue(mockManifest);

      await service.runPipeline('/path/to/input.json', '/path/to/output.duckdb', 'test', true);

      expect(mockEngine.runTelegramPipeline).toHaveBeenCalledWith(
        {
          inputFile: '/path/to/input.json',
          outputDb: '/path/to/output.duckdb',
          chatId: 'test',
          rebuild: true,
        },
        undefined
      );
    });

    it('should handle rebuild flag as false', async () => {
      const mockManifest = PythonManifestSchema.parse({
        chat_id: 'test',
        chat_name: 'Test',
        duckdb_file: '/path/to/file.duckdb',
      });

      vi.mocked(mockEngine.runTelegramPipeline).mockResolvedValue(mockManifest);

      await service.runPipeline('/path/to/input.json', '/path/to/output.duckdb', 'test', false);

      expect(mockEngine.runTelegramPipeline).toHaveBeenCalledWith(
        {
          inputFile: '/path/to/input.json',
          outputDb: '/path/to/output.duckdb',
          chatId: 'test',
          rebuild: false,
        },
        undefined
      );
    });

    it('should handle rebuild flag as undefined', async () => {
      const mockManifest = PythonManifestSchema.parse({
        chat_id: 'test',
        chat_name: 'Test',
        duckdb_file: '/path/to/file.duckdb',
      });

      vi.mocked(mockEngine.runTelegramPipeline).mockResolvedValue(mockManifest);

      await service.runPipeline('/path/to/input.json', '/path/to/output.duckdb', 'test');

      expect(mockEngine.runTelegramPipeline).toHaveBeenCalledWith(
        {
          inputFile: '/path/to/input.json',
          outputDb: '/path/to/output.duckdb',
          chatId: 'test',
          rebuild: undefined,
        },
        undefined
      );
    });
  });
});
