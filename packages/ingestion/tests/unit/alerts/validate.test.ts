/**
 * Unit tests for alert validation
 */

import { describe, it, expect } from 'vitest';
import { validateAlerts, getValidationSummary } from '../../../src/alerts/validate.js';
import type { CanonicalAlert } from '../../../src/alerts/normalize.js';

describe('validateAlerts', () => {
  const createValidAlert = (overrides?: Partial<CanonicalAlert>): CanonicalAlert => ({
    alert_ts_utc: '2024-01-01T00:00:00.000Z',
    chain: 'solana',
    mint: 'So11111111111111111111111111111111111111112',
    alert_chat_id: 12345,
    alert_message_id: 67890,
    alert_id: 'test_alert_123',
    caller_name_norm: 'brook',
    caller_id: 'brook',
    mint_source: 'text',
    bot_name: 'phanes',
    run_id: 'test_run_123',
    ...overrides,
  });

  it('should validate valid alert', () => {
    const alerts = [createValidAlert()];
    const result = validateAlerts(alerts);

    expect(result.valid).toHaveLength(1);
    expect(result.invalid).toHaveLength(0);
  });

  it('should reject alert with missing required field', () => {
    const alerts = [createValidAlert({ alert_ts_utc: '' })];
    const result = validateAlerts(alerts);

    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].code).toBe('missing_required_field');
    expect(result.invalid[0].reason).toContain('alert_ts_utc');
  });

  it('should reject alert with invalid timestamp', () => {
    const alerts = [createValidAlert({ alert_ts_utc: 'invalid-date' })];
    const result = validateAlerts(alerts);

    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].code).toBe('invalid_timestamp');
  });

  it('should reject alert with invalid chain', () => {
    const alerts = [createValidAlert({ chain: 'bitcoin' })];
    const result = validateAlerts(alerts);

    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].code).toBe('invalid_chain');
  });

  it('should reject alert with invalid Solana mint address (too short)', () => {
    const alerts = [createValidAlert({ mint: 'short' })];
    const result = validateAlerts(alerts);

    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].code).toBe('invalid_mint_address');
  });

  it('should reject alert with invalid Solana mint address (invalid base58)', () => {
    const alerts = [createValidAlert({ mint: '0x1234567890123456789012345678901234567890' })];
    const result = validateAlerts(alerts);

    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].code).toBe('invalid_mint_address');
  });

  it('should reject alert with invalid chat ID', () => {
    const alerts = [createValidAlert({ alert_chat_id: -1 })];
    const result = validateAlerts(alerts);

    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].code).toBe('invalid_chat_id');
  });

  it('should reject alert with invalid message ID', () => {
    const alerts = [createValidAlert({ alert_message_id: -1 })];
    const result = validateAlerts(alerts);

    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].code).toBe('invalid_message_id');
  });

  it('should reject duplicate alert IDs', () => {
    const alerts = [
      createValidAlert({ alert_id: 'duplicate_123' }),
      createValidAlert({ alert_id: 'duplicate_123' }),
    ];
    const result = validateAlerts(alerts);

    expect(result.valid).toHaveLength(1);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].code).toBe('duplicate_alert_id');
  });

  it('should validate EVM address', () => {
    const alerts = [
      createValidAlert({
        chain: 'evm',
        mint: '0x1234567890123456789012345678901234567890',
      }),
    ];
    const result = validateAlerts(alerts);

    expect(result.valid).toHaveLength(1);
    expect(result.invalid).toHaveLength(0);
  });

  it('should validate multiple alerts', () => {
    const alerts = [
      createValidAlert({ alert_id: 'alert_1' }),
      createValidAlert({ alert_id: 'alert_2', mint: '' }), // Invalid
      createValidAlert({ alert_id: 'alert_3' }),
    ];
    const result = validateAlerts(alerts);

    expect(result.valid).toHaveLength(2);
    expect(result.invalid).toHaveLength(1);
  });

  describe('getValidationSummary', () => {
    it('should generate summary for valid alerts', () => {
      const result = {
        valid: [createValidAlert(), createValidAlert({ alert_id: 'alert_2' })],
        invalid: [],
      };

      const summary = getValidationSummary(result);

      expect(summary).toContain('Total: 2');
      expect(summary).toContain('Valid: 2 (100.0%)');
      expect(summary).toContain('Invalid: 0');
    });

    it('should generate summary with invalid alerts', () => {
      const result = {
        valid: [createValidAlert()],
        invalid: [
          {
            alert: createValidAlert({ mint: '' }),
            reason: 'Missing mint',
            code: 'missing_required_field' as const,
          },
          {
            alert: createValidAlert({ mint: 'short' }),
            reason: 'Invalid mint',
            code: 'invalid_mint_address' as const,
          },
        ],
      };

      const summary = getValidationSummary(result);

      expect(summary).toContain('Total: 3');
      expect(summary).toContain('Valid: 1 (33.3%)');
      expect(summary).toContain('Invalid: 2');
      expect(summary).toContain('missing_required_field: 1');
      expect(summary).toContain('invalid_mint_address: 1');
    });
  });
});

