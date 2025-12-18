/**
 * TelegramJsonExportParser Tests
 *
 * Tests for parsing Telegram JSON export files with normalization.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseJsonExport } from '../../src/telegram/TelegramJsonExportParser';

describe('TelegramJsonExportParser', () => {
  const tempDir = path.join(__dirname, 'temp-json-exports');

  beforeEach(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        fs.unlinkSync(path.join(tempDir, file));
      }
      fs.rmdirSync(tempDir);
    }
  });

  it('should parse valid JSON export with messages', () => {
    const exportData = {
      name: 'Test Chat',
      type: 'private_group',
      id: 123456789,
      messages: [
        {
          id: 1,
          type: 'message',
          date: '2025-12-15T06:00:00Z',
          from: 'User1',
          text: 'Hello world',
        },
        {
          id: 2,
          type: 'message',
          date_unixtime: '1700000000',
          from: 'User2',
          text: 'Test message',
        },
      ],
    };

    const tempFile = path.join(tempDir, 'test-export.json');
    fs.writeFileSync(tempFile, JSON.stringify(exportData));

    const result = parseJsonExport(tempFile);

    expect(result.totalProcessed).toBe(2);
    expect(result.normalized.length).toBe(2);
    expect(result.quarantined.length).toBe(0);
    expect(result.normalized[0].messageId).toBe(1);
    expect(result.normalized[0].text).toBe('Hello world');
    expect(result.normalized[1].messageId).toBe(2);
  });

  it('should quarantine messages with missing id', () => {
    const exportData = {
      name: 'Test Chat',
      messages: [
        {
          type: 'message',
          date: '2025-12-15T06:00:00Z',
          text: 'No ID',
        },
      ],
    };

    const tempFile = path.join(tempDir, 'test-missing-id.json');
    fs.writeFileSync(tempFile, JSON.stringify(exportData));

    const result = parseJsonExport(tempFile);

    expect(result.totalProcessed).toBe(1);
    expect(result.normalized.length).toBe(0);
    expect(result.quarantined.length).toBe(1);
    expect(result.quarantined[0].error.code).toBe('MISSING_ID');
  });

  it('should quarantine messages with missing date', () => {
    const exportData = {
      name: 'Test Chat',
      messages: [
        {
          id: 1,
          type: 'message',
          text: 'No date',
        },
      ],
    };

    const tempFile = path.join(tempDir, 'test-missing-date.json');
    fs.writeFileSync(tempFile, JSON.stringify(exportData));

    const result = parseJsonExport(tempFile);

    expect(result.totalProcessed).toBe(1);
    expect(result.normalized.length).toBe(0);
    expect(result.quarantined.length).toBe(1);
    expect(result.quarantined[0].error.code).toBe('BAD_DATE');
  });

  it('should extract chat ID from export name', () => {
    const exportData = {
      name: 'My Test Chat',
      messages: [
        {
          id: 1,
          type: 'message',
          date: '2025-12-15T06:00:00Z',
          text: 'Test',
        },
      ],
    };

    const tempFile = path.join(tempDir, 'test-chat-id.json');
    fs.writeFileSync(tempFile, JSON.stringify(exportData));

    const result = parseJsonExport(tempFile);

    expect(result.normalized.length).toBe(1);
    expect(result.normalized[0].chatId).toBe('my_test_chat');
  });

  it('should use provided chat ID', () => {
    const exportData = {
      name: 'My Test Chat',
      messages: [
        {
          id: 1,
          type: 'message',
          date: '2025-12-15T06:00:00Z',
          text: 'Test',
        },
      ],
    };

    const tempFile = path.join(tempDir, 'test-provided-chat-id.json');
    fs.writeFileSync(tempFile, JSON.stringify(exportData));

    const result = parseJsonExport(tempFile, 'custom-chat-id');

    expect(result.normalized.length).toBe(1);
    expect(result.normalized[0].chatId).toBe('custom-chat-id');
  });

  it('should handle mixed valid and invalid messages', () => {
    const exportData = {
      name: 'Test Chat',
      messages: [
        {
          id: 1,
          type: 'message',
          date: '2025-12-15T06:00:00Z',
          text: 'Valid message',
        },
        {
          type: 'message',
          text: 'Invalid - no id',
        },
        {
          id: 3,
          type: 'message',
          text: 'Invalid - no date',
        },
        {
          id: 4,
          type: 'message',
          date: '2025-12-15T06:00:00Z',
          text: 'Another valid',
        },
      ],
    };

    const tempFile = path.join(tempDir, 'test-mixed.json');
    fs.writeFileSync(tempFile, JSON.stringify(exportData));

    const result = parseJsonExport(tempFile);

    expect(result.totalProcessed).toBe(4);
    expect(result.normalized.length).toBe(2);
    expect(result.quarantined.length).toBe(2);
    expect(result.normalized[0].messageId).toBe(1);
    expect(result.normalized[1].messageId).toBe(4);
  });

  it('should throw error for invalid JSON', () => {
    const tempFile = path.join(tempDir, 'test-invalid.json');
    fs.writeFileSync(tempFile, '{ invalid json }');

    expect(() => parseJsonExport(tempFile)).toThrow();
  });

  it('should throw error for missing file', () => {
    expect(() => parseJsonExport('/nonexistent/file.json')).toThrow('not found');
  });

  it('should throw error if messages is not an array', () => {
    const exportData = {
      name: 'Test Chat',
      messages: 'not an array',
    };

    const tempFile = path.join(tempDir, 'test-invalid-messages.json');
    fs.writeFileSync(tempFile, JSON.stringify(exportData));

    expect(() => parseJsonExport(tempFile)).toThrow('Expected messages array');
  });

  it('should handle empty messages array', () => {
    const exportData = {
      name: 'Test Chat',
      messages: [],
    };

    const tempFile = path.join(tempDir, 'test-empty.json');
    fs.writeFileSync(tempFile, JSON.stringify(exportData));

    const result = parseJsonExport(tempFile);

    expect(result.totalProcessed).toBe(0);
    expect(result.normalized.length).toBe(0);
    expect(result.quarantined.length).toBe(0);
  });
});
