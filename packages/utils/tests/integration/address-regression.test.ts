/**
 * Regression Tests (Real Telegram Message Fixtures)
 *
 * Tests against real message samples that previously broke parsing.
 * Lock in correct behavior for edge cases.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractCandidates } from '../../src/address/extract-candidates';
import { validateSolanaMint, validateEvmAddress } from '../../src/address/validate';

type TelegramMessageFixture = {
  id: string;
  text: string;
  expected_solana: string[];
  expected_evm: string[];
};

const fixturesPath = join(__dirname, '../fixtures/telegram-messages.json');
const fixtures: { messages: TelegramMessageFixture[] } = JSON.parse(
  readFileSync(fixturesPath, 'utf-8')
);

describe('Address Extraction - Regression Tests (Real Telegram Messages)', () => {
  for (const message of fixtures.messages) {
    it(`handles ${message.id} correctly`, () => {
      const candidates = extractCandidates(message.text);

      // Filter valid candidates (Pass 1 + Pass 2)
      const validSolana = candidates
        .filter((c) => c.addressType === 'solana' && !c.reason)
        .filter((c) => {
          const result = validateSolanaMint(c.normalized);
          return result.ok;
        })
        .map((c) => c.normalized);

      const validEvm = candidates
        .filter((c) => c.addressType === 'evm' && !c.reason)
        .map((c) => {
          const result = validateEvmAddress(c.normalized);
          if (result.ok) {
            return result.normalized; // Normalized to lowercase
          }
          return null;
        })
        .filter((addr): addr is string => addr !== null);

      // Check expected Solana addresses
      for (const expected of message.expected_solana) {
        expect(validSolana).toContain(expected);
      }

      // Check expected EVM addresses (normalized to lowercase)
      for (const expected of message.expected_evm) {
        const normalized = expected.toLowerCase();
        expect(validEvm).toContain(normalized);
      }

      // Check counts match
      expect(validSolana.length).toBe(message.expected_solana.length);
      expect(validEvm.length).toBe(message.expected_evm.length);
    });
  }
});
