/**
 * Telegram Normalizer Tests
 *
 * Tests for normalizing raw Telegram JSON message blobs into canonical format.
 * Every new Telegram "WTF" becomes a test fixture forever.
 */

import { describe, it, expect } from 'vitest';
import { normalizeTelegramMessage } from '../../src/telegram/normalize';

describe('telegram normalize', () => {
  it('handles text as string', () => {
    const raw = {
      id: 1,
      type: 'message',
      date: '2025-12-15T06:00:00',
      from: 'A',
      text: 'hello',
    };
    const r = normalizeTelegramMessage(raw, 'chat1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.text).toBe('hello');
    expect(r.value.messageId).toBe(1);
    expect(r.value.chatId).toBe('chat1');
  });

  it('handles text as array with link objects', () => {
    const raw = {
      id: 2,
      type: 'message',
      date_unixtime: '1700000000',
      from: 'B',
      text: ['go ', { type: 'link', text: 'site', href: 'https://x.y' }, '!'],
    };
    const r = normalizeTelegramMessage(raw, 'chat1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.text).toBe('go site!');
    expect(r.value.links.length).toBe(1);
    expect(r.value.links[0].href).toBe('https://x.y');
    expect(r.value.links[0].text).toBe('site');
  });

  it('quarantines missing id', () => {
    const raw = { type: 'message', date: '2025-12-15T06:00:00', text: 'no id' };
    const r = normalizeTelegramMessage(raw, 'chat1');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('MISSING_ID');
    expect(r.raw).toBe(raw);
  });

  it('quarantines invalid id', () => {
    const raw = { id: -1, type: 'message', date: '2025-12-15T06:00:00', text: 'bad id' };
    const r = normalizeTelegramMessage(raw, 'chat1');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('MISSING_ID');
  });

  it('quarantines missing date', () => {
    const raw = { id: 3, type: 'message', text: 'no date' };
    const r = normalizeTelegramMessage(raw, 'chat1');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('BAD_DATE');
  });

  it('marks service-like messages', () => {
    const raw = {
      id: 3,
      type: 'service',
      date: '2025-12-15T06:00:00',
      actor: 'X',
      action: 'join',
    };
    const r = normalizeTelegramMessage(raw, 'chat1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.isService).toBe(true);
    expect(r.value.type).toBe('service');
  });

  it('marks messages with action as service', () => {
    const raw = {
      id: 4,
      type: 'message',
      date: '2025-12-15T06:00:00',
      action: 'pin',
    };
    const r = normalizeTelegramMessage(raw, 'chat1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.isService).toBe(true);
  });

  it('uses chatId+messageId as stable identity', () => {
    const raw = { id: '4', type: 'message', date: '2025-12-15T06:00:00', text: 'x' };
    const r = normalizeTelegramMessage(raw, 'chatABC');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.chatId).toBe('chatABC');
    expect(r.value.messageId).toBe(4);
  });

  it('handles date_unixtime as number', () => {
    const raw = {
      id: 5,
      type: 'message',
      date_unixtime: 1700000000,
      text: 'test',
    };
    const r = normalizeTelegramMessage(raw, 'chat1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.timestampMs).toBe(1700000000 * 1000);
  });

  it('handles date_unixtime as string', () => {
    const raw = {
      id: 6,
      type: 'message',
      date_unixtime: '1700000000',
      text: 'test',
    };
    const r = normalizeTelegramMessage(raw, 'chat1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.timestampMs).toBe(1700000000 * 1000);
  });

  it('handles ISO date string', () => {
    const raw = {
      id: 7,
      type: 'message',
      date: '2025-12-15T06:00:00Z',
      text: 'test',
    };
    const r = normalizeTelegramMessage(raw, 'chat1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.timestampMs).toBeGreaterThan(0);
  });

  it('handles missing from field', () => {
    const raw = {
      id: 8,
      type: 'message',
      date: '2025-12-15T06:00:00',
      text: 'anonymous',
    };
    const r = normalizeTelegramMessage(raw, 'chat1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.fromName).toBeNull();
    expect(r.value.fromId).toBeNull();
  });

  it('handles from_id field', () => {
    const raw = {
      id: 9,
      type: 'message',
      date: '2025-12-15T06:00:00',
      from: 'User',
      from_id: 'user123',
      text: 'test',
    };
    const r = normalizeTelegramMessage(raw, 'chat1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.fromName).toBe('User');
    expect(r.value.fromId).toBe('user123');
  });

  it('handles reply_to_message_id', () => {
    const raw = {
      id: 10,
      type: 'message',
      date: '2025-12-15T06:00:00',
      text: 'reply',
      reply_to_message_id: 5,
    };
    const r = normalizeTelegramMessage(raw, 'chat1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.replyToMessageId).toBe(5);
  });

  it('handles reply_to_message_id as string', () => {
    const raw = {
      id: 11,
      type: 'message',
      date: '2025-12-15T06:00:00',
      text: 'reply',
      reply_to_message_id: '5',
    };
    const r = normalizeTelegramMessage(raw, 'chat1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.replyToMessageId).toBe(5);
  });

  it('handles empty text', () => {
    const raw = {
      id: 12,
      type: 'message',
      date: '2025-12-15T06:00:00',
      text: '',
    };
    const r = normalizeTelegramMessage(raw, 'chat1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.text).toBe('');
  });

  it('handles null text', () => {
    const raw = {
      id: 13,
      type: 'message',
      date: '2025-12-15T06:00:00',
      text: null,
    };
    const r = normalizeTelegramMessage(raw, 'chat1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.text).toBe('');
  });

  it('handles text array with mixed types', () => {
    const raw = {
      id: 14,
      type: 'message',
      date: '2025-12-15T06:00:00',
      text: ['hello', ' ', { type: 'link', text: 'world', href: 'https://example.com' }, '!'],
    };
    const r = normalizeTelegramMessage(raw, 'chat1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.text).toBe('hello world!');
    expect(r.value.links.length).toBe(1);
    expect(r.value.links[0].text).toBe('world');
    expect(r.value.links[0].href).toBe('https://example.com');
  });

  it('preserves raw blob for debugging', () => {
    const raw = {
      id: 15,
      type: 'message',
      date: '2025-12-15T06:00:00',
      text: 'test',
      customField: 'preserved',
    };
    const r = normalizeTelegramMessage(raw, 'chat1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.value.raw as any).customField).toBe('preserved');
  });

  it('quarantines non-object input', () => {
    const r = normalizeTelegramMessage('not an object', 'chat1');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('UNKNOWN_SHAPE');
  });

  it('quarantines null input', () => {
    const r = normalizeTelegramMessage(null, 'chat1');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('UNKNOWN_SHAPE');
  });

  it('handles text with null bytes', () => {
    const raw = {
      id: 16,
      type: 'message',
      date: '2025-12-15T06:00:00',
      text: 'hello\u0000world',
    };
    const r = normalizeTelegramMessage(raw, 'chat1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.text).toBe('helloworld');
  });

  it('handles text with CRLF newlines', () => {
    const raw = {
      id: 17,
      type: 'message',
      date: '2025-12-15T06:00:00',
      text: 'line1\r\nline2',
    };
    const r = normalizeTelegramMessage(raw, 'chat1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.text).toBe('line1\nline2');
  });

  it('handles multiple links in text array', () => {
    const raw = {
      id: 18,
      type: 'message',
      date: '2025-12-15T06:00:00',
      text: [
        'Check ',
        { type: 'link', text: 'this', href: 'https://a.com' },
        ' and ',
        { type: 'link', text: 'that', href: 'https://b.com' },
        '!',
      ],
    };
    const r = normalizeTelegramMessage(raw, 'chat1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.text).toBe('Check this and that!');
    expect(r.value.links.length).toBe(2);
    expect(r.value.links[0].href).toBe('https://a.com');
    expect(r.value.links[1].href).toBe('https://b.com');
  });

  it('handles link without href', () => {
    const raw = {
      id: 19,
      type: 'message',
      date: '2025-12-15T06:00:00',
      text: [{ type: 'link', text: 'no href' }],
    };
    const r = normalizeTelegramMessage(raw, 'chat1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.text).toBe('no href');
    expect(r.value.links.length).toBe(0);
  });

  it('handles empty from name', () => {
    const raw = {
      id: 20,
      type: 'message',
      date: '2025-12-15T06:00:00',
      from: '',
      text: 'test',
    };
    const r = normalizeTelegramMessage(raw, 'chat1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.fromName).toBeNull();
  });
});
