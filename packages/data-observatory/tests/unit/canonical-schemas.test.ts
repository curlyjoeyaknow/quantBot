/**
 * Canonical Schema Tests
 */

import { describe, it, expect } from 'vitest';
import {
  CanonicalEventSchema,
  CallEventSchema,
  CandleEventSchema,
  createCanonicalEvent,
  isEventMissing,
} from '../../src/canonical/schemas.js';

describe('CanonicalEventSchema', () => {
  it('should validate a valid canonical event', () => {
    const event = {
      asset: 'So11111111111111111111111111111111111111112',
      chain: 'solana',
      venue: 'pump.fun',
      timestamp: '2024-01-01T00:00:00Z',
      eventType: 'call',
      value: { side: 'buy', signalType: 'entry' },
      isMissing: false,
    };

    const result = CanonicalEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });

  it('should reject event with invalid asset length', () => {
    const event = {
      asset: 'short',
      chain: 'solana',
      venue: 'pump.fun',
      timestamp: '2024-01-01T00:00:00Z',
      eventType: 'call',
      value: { side: 'buy', signalType: 'entry' },
    };

    const result = CanonicalEventSchema.safeParse(event);
    expect(result.success).toBe(false);
  });

  it('should validate a call event', () => {
    const event = {
      asset: 'So11111111111111111111111111111111111111112',
      chain: 'solana',
      venue: 'telegram',
      timestamp: '2024-01-01T00:00:00Z',
      eventType: 'call' as const,
      value: {
        side: 'buy' as const,
        signalType: 'entry' as const,
        signalStrength: 0.8,
        price: 0.001,
        callerName: 'test_caller',
      },
      isMissing: false,
    };

    const result = CallEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });

  it('should validate a candle event', () => {
    const event = {
      asset: 'So11111111111111111111111111111111111111112',
      chain: 'solana',
      venue: 'birdeye',
      timestamp: '2024-01-01T00:00:00Z',
      eventType: 'candle' as const,
      value: {
        open: 0.001,
        high: 0.002,
        low: 0.0005,
        close: 0.0015,
        volume: 1000,
        interval: '5m' as const,
      },
      isMissing: false,
    };

    const result = CandleEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });
});

describe('createCanonicalEvent', () => {
  it('should create a canonical event with defaults', () => {
    const event = createCanonicalEvent({
      asset: 'So11111111111111111111111111111111111111112',
      chain: 'solana',
      venue: 'pump.fun',
      timestamp: '2024-01-01T00:00:00Z',
      eventType: 'call',
      value: { side: 'buy', signalType: 'entry' },
    });

    expect(event.isMissing).toBe(false);
    expect(event.asset).toBe('So11111111111111111111111111111111111111112');
  });
});

describe('isEventMissing', () => {
  it('should detect missing event', () => {
    const event = createCanonicalEvent({
      asset: 'So11111111111111111111111111111111111111112',
      chain: 'solana',
      venue: 'pump.fun',
      timestamp: '2024-01-01T00:00:00Z',
      eventType: 'call',
      value: null,
      isMissing: true,
    });

    expect(isEventMissing(event)).toBe(true);
  });

  it('should detect non-missing event', () => {
    const event = createCanonicalEvent({
      asset: 'So11111111111111111111111111111111111111112',
      chain: 'solana',
      venue: 'pump.fun',
      timestamp: '2024-01-01T00:00:00Z',
      eventType: 'call',
      value: { side: 'buy', signalType: 'entry' },
      isMissing: false,
    });

    expect(isEventMissing(event)).toBe(false);
  });
});

