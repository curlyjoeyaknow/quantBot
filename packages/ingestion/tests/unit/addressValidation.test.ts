import { describe, it, expect } from 'vitest';
import { isEvmAddress, isSolanaAddress } from '@quantbot/utils';
import { extractAddresses } from '../../src/addressValidation';

/**
 * Test vectors
 * ============
 * EVM addresses: same for ETH/Base/BSC. Can't infer chain from the string.
 * Solana: base58, length 32–44.
 */

// --------------------
// EVM (ETH/Base/BSC)
// --------------------
const EVM_GOOD = [
  '0x0000000000000000000000000000000000000000',
  '0x1111111111111111111111111111111111111111',
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // mixed case, still valid format-wise
  '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
];

const EVM_BAD = [
  '0x', // too short
  '0x123', // too short
  '0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ', // non-hex
  '0Xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', // wrong prefix (0X)
  'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', // missing 0x
  '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbee', // 39 hex chars
  '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef00', // 42 hex chars
  '0xdeadbeef-deadbeefdeadbeefdeadbeefdeadbeef', // hyphen
];

// --------------------
// Solana
// --------------------
// Use known valid-ish base58 length examples. We validate format only, not curve.
// "So11111111111111111111111111111111111111112" is commonly used (WSOL mint).
const SOL_GOOD = [
  'So11111111111111111111111111111111111111112',
  '11111111111111111111111111111111', // System Program (valid format)
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token Program (valid format)
];

const SOL_BAD = [
  '', // empty
  'So111', // too short
  'O0IlO0IlO0IlO0IlO0IlO0IlO0IlO0Il', // invalid chars (O,0,I,l are not base58 set)
  'So1111111111111111111111111111111111111111O', // contains 'O' invalid base58
  'So111111111111111111111111111111111111111122222', // too long
  '0xSo11111111111111111111111111111111111111112', // has 0x prefix, not sol
];

describe('addressValidation - EVM', () => {
  it('accepts valid EVM address format', () => {
    for (const a of EVM_GOOD) {
      expect(isEvmAddress(a)).toBe(true);
    }
  });

  it('rejects invalid EVM address format', () => {
    for (const a of EVM_BAD) {
      expect(isEvmAddress(a)).toBe(false);
    }
  });
});

describe('addressValidation - Solana', () => {
  it('accepts valid Solana base58 format (32–44 chars)', () => {
    for (const a of SOL_GOOD) {
      expect(isSolanaAddress(a)).toBe(true);
    }
  });

  it('rejects invalid Solana candidates', () => {
    for (const a of SOL_BAD) {
      expect(isSolanaAddress(a)).toBe(false);
    }
  });
});

describe('extractAddresses - Telegram text extraction', () => {
  it('extracts EVM + Solana addresses from messy text and de-dupes', () => {
    const text = `
      NEW CA 🚨🚨🚨
      Sol: So11111111111111111111111111111111111111112
      EVM: 0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef
      (again) 0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef
      junk: 0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ
      also: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
    `;

    const out = extractAddresses(text);

    expect(out.evm).toEqual(['0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef']);
    expect(out.solana).toEqual([
      'So11111111111111111111111111111111111111112',
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    ]);
  });

  it('does not hallucinate solana addresses from base58-ish noise', () => {
    // 32–44 chars but contains forbidden chars => must not extract
    const text = `CA: O0IlO0IlO0IlO0IlO0IlO0IlO0IlO0Il`;
    const out = extractAddresses(text);
    expect(out.solana).toEqual([]);
    expect(out.evm).toEqual([]);
  });

  it('extracts multiple different EVM addresses in order (ETH/Base/BSC format)', () => {
    const text = `
      ETH: 0x1111111111111111111111111111111111111111
      BASE: 0x0000000000000000000000000000000000000000
      BSC: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
    `;
    const out = extractAddresses(text);
    expect(out.evm).toEqual([
      '0x1111111111111111111111111111111111111111',
      '0x0000000000000000000000000000000000000000',
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    ]);
  });

  it('does not treat 0X prefix as EVM address', () => {
    const text = `fake: 0Xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef`;
    const out = extractAddresses(text);
    expect(out.evm).toEqual([]);
  });
});
