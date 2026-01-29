/**
 * Unit tests for alert normalization
 */

import { describe, it, expect } from 'vitest';
import { normalizeAlerts, type NormalizeAlertsOptions } from '../../../src/alerts/normalize.js';
import type { NormalizedTelegramMessage } from '../../../src/telegram/normalize.js';

describe('normalizeAlerts', () => {
  const baseOptions: NormalizeAlertsOptions = {
    chain: 'solana',
    runId: 'test_run_123',
  };

  it('should normalize valid Solana alert', () => {
    const messages: NormalizedTelegramMessage[] = [
      {
        chatId: 'test_chat',
        messageId: 12345,
        type: 'message',
        timestampMs: 1704067200000, // 2024-01-01 00:00:00 UTC
        fromName: 'Brook',
        fromId: 'user123',
        text: 'Check out this token: So11111111111111111111111111111111111111112',
        links: [],
        replyToMessageId: null,
        isService: false,
        raw: {},
      },
    ];

    const result = normalizeAlerts(messages, baseOptions);

    expect(result.alerts).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);

    const alert = result.alerts[0];
    expect(alert.chain).toBe('solana');
    expect(alert.mint).toBe('So11111111111111111111111111111111111111112');
    expect(alert.caller_name_norm).toBe('brook');
    expect(alert.caller_id).toBe('brook');
    expect(alert.mint_source).toBe('text');
    expect(alert.run_id).toBe('test_run_123');
    expect(alert.alert_ts_utc).toBe('2024-01-01T00:00:00.000Z');
  });

  it('should skip service messages', () => {
    const messages: NormalizedTelegramMessage[] = [
      {
        chatId: 'test_chat',
        messageId: 12345,
        type: 'service',
        timestampMs: 1704067200000,
        fromName: null,
        fromId: null,
        text: 'User joined the chat',
        links: [],
        replyToMessageId: null,
        isService: true,
        raw: {},
      },
    ];

    const result = normalizeAlerts(messages, baseOptions);

    expect(result.alerts).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe('service_message');
  });

  it('should skip messages with no mint', () => {
    const messages: NormalizedTelegramMessage[] = [
      {
        chatId: 'test_chat',
        messageId: 12345,
        type: 'message',
        timestampMs: 1704067200000,
        fromName: 'Brook',
        fromId: 'user123',
        text: 'Hello world',
        links: [],
        replyToMessageId: null,
        isService: false,
        raw: {},
      },
    ];

    const result = normalizeAlerts(messages, baseOptions);

    expect(result.alerts).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe('no_mint_found');
  });

  it('should use default caller name if fromName is missing', () => {
    const messages: NormalizedTelegramMessage[] = [
      {
        chatId: 'test_chat',
        messageId: 12345,
        type: 'message',
        timestampMs: 1704067200000,
        fromName: null,
        fromId: null,
        text: 'Check out: So11111111111111111111111111111111111111112',
        links: [],
        replyToMessageId: null,
        isService: false,
        raw: {},
      },
    ];

    const options: NormalizeAlertsOptions = {
      ...baseOptions,
      defaultCallerName: 'DefaultCaller',
    };

    const result = normalizeAlerts(messages, options);

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].caller_name_norm).toBe('defaultcaller');
  });

  it('should skip messages with no caller name', () => {
    const messages: NormalizedTelegramMessage[] = [
      {
        chatId: 'test_chat',
        messageId: 12345,
        type: 'message',
        timestampMs: 1704067200000,
        fromName: null,
        fromId: null,
        text: 'Check out: So11111111111111111111111111111111111111112',
        links: [],
        replyToMessageId: null,
        isService: false,
        raw: {},
      },
    ];

    const result = normalizeAlerts(messages, baseOptions);

    expect(result.alerts).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe('no_caller_name');
  });

  it('should extract multiple mints from single message', () => {
    const messages: NormalizedTelegramMessage[] = [
      {
        chatId: 'test_chat',
        messageId: 12345,
        type: 'message',
        timestampMs: 1704067200000,
        fromName: 'Brook',
        fromId: 'user123',
        text: 'Two tokens: So11111111111111111111111111111111111111112 and EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        links: [],
        replyToMessageId: null,
        isService: false,
        raw: {},
      },
    ];

    const result = normalizeAlerts(messages, baseOptions);

    expect(result.alerts).toHaveLength(2);
    expect(result.alerts[0].mint).toBe('So11111111111111111111111111111111111111112');
    expect(result.alerts[1].mint).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  });

  it('should extract mints from links', () => {
    const messages: NormalizedTelegramMessage[] = [
      {
        chatId: 'test_chat',
        messageId: 12345,
        type: 'message',
        timestampMs: 1704067200000,
        fromName: 'Brook',
        fromId: 'user123',
        text: 'Check this out',
        links: [
          {
            text: 'Token',
            href: 'https://solscan.io/token/So11111111111111111111111111111111111111112',
          },
        ],
        replyToMessageId: null,
        isService: false,
        raw: {},
      },
    ];

    const result = normalizeAlerts(messages, baseOptions);

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].mint).toBe('So11111111111111111111111111111111111111112');
    expect(result.alerts[0].mint_source).toBe('link');
  });

  it('should normalize caller name (lowercase, underscores)', () => {
    const messages: NormalizedTelegramMessage[] = [
      {
        chatId: 'test_chat',
        messageId: 12345,
        type: 'message',
        timestampMs: 1704067200000,
        fromName: 'Brook The Trader',
        fromId: 'user123',
        text: 'Token: So11111111111111111111111111111111111111112',
        links: [],
        replyToMessageId: null,
        isService: false,
        raw: {},
      },
    ];

    const result = normalizeAlerts(messages, baseOptions);

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].caller_name_norm).toBe('brook_the_trader');
  });

  it('should extract bot name from message', () => {
    const messages: NormalizedTelegramMessage[] = [
      {
        chatId: 'test_chat',
        messageId: 12345,
        type: 'message',
        timestampMs: 1704067200000,
        fromName: 'Brook',
        fromId: 'user123',
        text: 'Phanes: Token alert So11111111111111111111111111111111111111112',
        links: [],
        replyToMessageId: null,
        isService: false,
        raw: {},
      },
    ];

    const result = normalizeAlerts(messages, baseOptions);

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].bot_name).toBe('phanes');
  });

  it('should handle EVM addresses', () => {
    const messages: NormalizedTelegramMessage[] = [
      {
        chatId: 'test_chat',
        messageId: 12345,
        type: 'message',
        timestampMs: 1704067200000,
        fromName: 'Brook',
        fromId: 'user123',
        text: 'EVM token: 0x1234567890123456789012345678901234567890',
        links: [],
        replyToMessageId: null,
        isService: false,
        raw: {},
      },
    ];

    const options: NormalizeAlertsOptions = {
      ...baseOptions,
      chain: 'evm',
    };

    const result = normalizeAlerts(messages, options);

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].chain).toBe('evm');
    expect(result.alerts[0].mint).toBe('0x1234567890123456789012345678901234567890');
  });

  it('should preserve exact mint address (no truncation, no case change)', () => {
    const messages: NormalizedTelegramMessage[] = [
      {
        chatId: 'test_chat',
        messageId: 12345,
        type: 'message',
        timestampMs: 1704067200000,
        fromName: 'Brook',
        fromId: 'user123',
        text: 'Token: So11111111111111111111111111111111111111112',
        links: [],
        replyToMessageId: null,
        isService: false,
        raw: {},
      },
    ];

    const result = normalizeAlerts(messages, baseOptions);

    // Verify exact preservation
    expect(result.alerts[0].mint).toBe('So11111111111111111111111111111111111111112');
    expect(result.alerts[0].mint.length).toBe(44);
  });
});

