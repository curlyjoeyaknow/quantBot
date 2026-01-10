/**
 * TelegramMessageStreamProcessor Tests
 *
 * Tests for writing normalized and quarantined messages to NDJSON streams.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { TelegramMessageStreamProcessor } from '../../src/telegram/TelegramMessageStreamProcessor';
import type { NormalizedTelegramMessage } from '../../src/telegram/normalize';

describe('TelegramMessageStreamProcessor', () => {
  const tempDir = path.join(__dirname, 'temp-streams');

  beforeEach(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterEach(async () => {
    // Wait a bit for any async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(tempDir, file));
        } catch (err) {
          // Ignore errors if file is already deleted
        }
      }
      try {
        fs.rmdirSync(tempDir);
      } catch (err) {
        // Ignore errors if directory is not empty or already deleted
      }
    }
  });

  it('should write normalized messages to NDJSON', async () => {
    const processor = new TelegramMessageStreamProcessor({
      outputDir: tempDir,
      writeNormalized: true,
      writeQuarantine: false,
    });

    processor.initialize('test');

    const message1: NormalizedTelegramMessage = {
      chatId: 'chat1',
      messageId: 1,
      type: 'message',
      timestampMs: 1700000000000,
      fromName: 'User1',
      fromId: null,
      text: 'Hello',
      links: [],
      replyToMessageId: null,
      isService: false,
      raw: { id: 1, text: 'Hello' },
    };

    const message2: NormalizedTelegramMessage = {
      chatId: 'chat1',
      messageId: 2,
      type: 'message',
      timestampMs: 1700000100000,
      fromName: 'User2',
      fromId: null,
      text: 'World',
      links: [],
      replyToMessageId: null,
      isService: false,
      raw: { id: 2, text: 'World' },
    };

    processor.writeNormalized(message1);
    processor.writeNormalized(message2);

    const result = await processor.close();

    expect(result.normalizedWritten).toBe(2);
    expect(result.quarantinedWritten).toBe(0);
    expect(result.normalizedPath).toBeDefined();

    // Verify file contents
    if (result.normalizedPath && fs.existsSync(result.normalizedPath)) {
      const content = fs.readFileSync(result.normalizedPath, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(2);

      const parsed1 = JSON.parse(lines[0]);
      expect(parsed1.messageId).toBe(1);
      expect(parsed1.text).toBe('Hello');

      const parsed2 = JSON.parse(lines[1]);
      expect(parsed2.messageId).toBe(2);
      expect(parsed2.text).toBe('World');
    }
  });

  it('should write quarantined messages to NDJSON', async () => {
    const processor = new TelegramMessageStreamProcessor({
      outputDir: tempDir,
      writeNormalized: false,
      writeQuarantine: true,
    });

    processor.initialize('test');

    processor.writeQuarantine(
      { code: 'MISSING_ID', message: 'Missing/invalid message id' },
      { type: 'message', text: 'No ID' }
    );

    processor.writeQuarantine(
      { code: 'BAD_DATE', message: 'Missing/invalid date/date_unixtime' },
      { id: 1, text: 'No date' }
    );

    const result = await processor.close();

    expect(result.normalizedWritten).toBe(0);
    expect(result.quarantinedWritten).toBe(2);
    expect(result.quarantinePath).toBeDefined();

    // Verify file contents
    if (result.quarantinePath && fs.existsSync(result.quarantinePath)) {
      const content = fs.readFileSync(result.quarantinePath, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(2);

      const parsed1 = JSON.parse(lines[0]);
      expect(parsed1.error.code).toBe('MISSING_ID');
      expect(parsed1.raw).toEqual({ type: 'message', text: 'No ID' });

      const parsed2 = JSON.parse(lines[1]);
      expect(parsed2.error.code).toBe('BAD_DATE');
    }
  });

  it('should write both normalized and quarantined messages', async () => {
    const processor = new TelegramMessageStreamProcessor({
      outputDir: tempDir,
      writeNormalized: true,
      writeQuarantine: true,
    });

    processor.initialize('test');

    const message: NormalizedTelegramMessage = {
      chatId: 'chat1',
      messageId: 1,
      type: 'message',
      timestampMs: 1700000000000,
      fromName: 'User1',
      fromId: null,
      text: 'Valid',
      links: [],
      replyToMessageId: null,
      isService: false,
      raw: { id: 1, text: 'Valid' },
    };

    processor.writeNormalized(message);
    processor.writeQuarantine(
      { code: 'MISSING_ID', message: 'Missing/invalid message id' },
      { text: 'Invalid' }
    );

    const result = await processor.close();

    expect(result.normalizedWritten).toBe(1);
    expect(result.quarantinedWritten).toBe(1);
    expect(result.normalizedPath).toBeDefined();
    expect(result.quarantinePath).toBeDefined();
  });

  it('should handle batch writes', async () => {
    const processor = new TelegramMessageStreamProcessor({
      outputDir: tempDir,
      writeNormalized: true,
      writeQuarantine: true,
    });

    processor.initialize('test');

    const messages: NormalizedTelegramMessage[] = [
      {
        chatId: 'chat1',
        messageId: 1,
        type: 'message',
        timestampMs: 1700000000000,
        fromName: 'User1',
        fromId: null,
        text: 'Message 1',
        links: [],
        replyToMessageId: null,
        isService: false,
        raw: { id: 1, text: 'Message 1' },
      },
      {
        chatId: 'chat1',
        messageId: 2,
        type: 'message',
        timestampMs: 1700000100000,
        fromName: 'User2',
        fromId: null,
        text: 'Message 2',
        links: [],
        replyToMessageId: null,
        isService: false,
        raw: { id: 2, text: 'Message 2' },
      },
    ];

    processor.writeNormalizedBatch(messages);
    processor.writeQuarantineBatch([
      {
        error: { code: 'MISSING_ID', message: 'Missing/invalid message id' },
        raw: { text: 'Invalid 1' },
      },
      {
        error: { code: 'BAD_DATE', message: 'Missing/invalid date/date_unixtime' },
        raw: { id: 3, text: 'Invalid 2' },
      },
    ]);

    const result = await processor.close();

    expect(result.normalizedWritten).toBe(2);
    expect(result.quarantinedWritten).toBe(2);
  });

  it('should track statistics', () => {
    const processor = new TelegramMessageStreamProcessor({
      outputDir: tempDir,
      writeNormalized: true,
      writeQuarantine: true,
    });

    processor.initialize('test');

    const message: NormalizedTelegramMessage = {
      chatId: 'chat1',
      messageId: 1,
      type: 'message',
      timestampMs: 1700000000000,
      fromName: 'User1',
      fromId: null,
      text: 'Test',
      links: [],
      replyToMessageId: null,
      isService: false,
      raw: { id: 1, text: 'Test' },
    };

    processor.writeNormalized(message);
    processor.writeQuarantine(
      { code: 'MISSING_ID', message: 'Missing/invalid message id' },
      { text: 'Invalid' }
    );

    const stats = processor.getStats();
    expect(stats.normalized).toBe(1);
    expect(stats.quarantined).toBe(1);
  });

  it('should not write when streams are disabled', async () => {
    const processor = new TelegramMessageStreamProcessor({
      outputDir: tempDir,
      writeNormalized: false,
      writeQuarantine: false,
    });

    processor.initialize('test');

    const message: NormalizedTelegramMessage = {
      chatId: 'chat1',
      messageId: 1,
      type: 'message',
      timestampMs: 1700000000000,
      fromName: 'User1',
      fromId: null,
      text: 'Test',
      links: [],
      replyToMessageId: null,
      isService: false,
      raw: { id: 1, text: 'Test' },
    };

    processor.writeNormalized(message);
    processor.writeQuarantine(
      { code: 'MISSING_ID', message: 'Missing/invalid message id' },
      { text: 'Invalid' }
    );

    const result = await processor.close();

    expect(result.normalizedWritten).toBe(0);
    expect(result.quarantinedWritten).toBe(0);
    expect(result.normalizedPath).toBeUndefined();
    expect(result.quarantinePath).toBeUndefined();
  });
});
