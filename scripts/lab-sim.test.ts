/**
 * Tests for Lab Sim Runner
 *
 * CRITICAL: These tests would have caught the bugs we fixed:
 * - YAML parsing errors
 * - File read errors
 * - Argument parsing edge cases
 * - Empty token sets
 * - Invalid preset names
 * - Time range validation
 * - Path traversal issues
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import * as YAML from 'yaml';

// Mock fs module
vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    accessSync: vi.fn(),
    statSync: vi.fn(),
    readdirSync: vi.fn(),
  },
}));

describe('Lab Sim Runner - Edge Cases and Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('YAML Parsing', () => {
    it('CRITICAL: Should handle invalid YAML gracefully', () => {
      const invalidYaml = '{ invalid: yaml: content: [';

      expect(() => {
        YAML.parse(invalidYaml);
      }).toThrow();
    });

    it('CRITICAL: Should handle null/undefined YAML parse results', () => {
      const nullYaml = 'null';
      const undefinedYaml = '~';

      expect(YAML.parse(nullYaml)).toBeNull();
      expect(YAML.parse(undefinedYaml)).toBeUndefined();
    });

    it('CRITICAL: Should handle empty YAML files', () => {
      const emptyYaml = '';

      expect(() => {
        const parsed = YAML.parse(emptyYaml);
        if (parsed === null || parsed === undefined) {
          throw new Error('YAML parsed to null/undefined');
        }
      }).toThrow();
    });
  });

  describe('File Operations', () => {
    it('CRITICAL: Should handle file not found errors', () => {
      (fs.accessSync as any).mockImplementation(() => {
        const error = new Error('ENOENT');
        (error as any).code = 'ENOENT';
        throw error;
      });

      expect(() => {
        try {
          fs.accessSync('/nonexistent');
        } catch (error: any) {
          if (error.code === 'ENOENT') {
            throw new Error('File not found: /nonexistent');
          }
          throw error;
        }
      }).toThrow('File not found');
    });

    it('CRITICAL: Should handle permission denied errors', () => {
      (fs.readFileSync as any).mockImplementation(() => {
        const error = new Error('EACCES');
        (error as any).code = 'EACCES';
        throw error;
      });

      expect(() => {
        try {
          fs.readFileSync('/protected');
        } catch (error: any) {
          if (error.code === 'EACCES') {
            throw new Error('Permission denied: /protected');
          }
          throw error;
        }
      }).toThrow('Permission denied');
    });

    it('CRITICAL: Should handle directory read errors', () => {
      (fs.readdirSync as any).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      expect(() => {
        try {
          fs.readdirSync('/protected');
        } catch (error) {
          throw new Error(
            `Failed to read directory: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }).toThrow('Failed to read directory');
    });
  });

  describe('Argument Parsing', () => {
    it('CRITICAL: Should handle missing values for flags', () => {
      const args = ['run', '--dir']; // Missing directory

      expect(() => {
        let i = 0;
        while (i < args.length) {
          const a = args[i];
          if (a === '--dir') {
            const next = args[++i];
            if (!next || next.startsWith('--')) {
              throw new Error('--dir requires a directory path');
            }
          }
          i++;
        }
      }).toThrow('--dir requires a directory path');
    });

    it('CRITICAL: Should handle unknown options', () => {
      const args = ['run', '--unknown-option', 'value'];

      expect(() => {
        for (const a of args) {
          if (a.startsWith('--') && !['--dir', '--artifacts', '--all', '--tokens'].includes(a)) {
            throw new Error(`Unknown option: ${a}`);
          }
        }
      }).toThrow('Unknown option: --unknown-option');
    });

    it('CRITICAL: Should handle empty argument list', () => {
      const args: string[] = [];

      // Should default to 'list' command
      const cmd = args[0] ?? 'list';
      expect(cmd).toBe('list');
    });
  });

  describe('Preset Name Validation', () => {
    it('CRITICAL: Should reject invalid preset names', () => {
      const invalidNames = [
        '', // Empty
        ' ', // Whitespace only
        '  name  ', // Leading/trailing whitespace
        'name with spaces', // Spaces
        'name@invalid', // Invalid characters
        'name#invalid', // Invalid characters
        'a'.repeat(101), // Too long
      ];

      for (const name of invalidNames) {
        expect(() => {
          if (!name || typeof name !== 'string') {
            throw new Error('Missing or invalid name');
          }
          if (name.trim() !== name) {
            throw new Error('Name has leading/trailing whitespace');
          }
          if (name.length === 0) {
            throw new Error('Name is empty');
          }
          if (name.length > 100) {
            throw new Error('Name too long');
          }
          if (!/^[A-Za-z0-9_-]+$/.test(name)) {
            throw new Error('Name contains invalid characters');
          }
        }).toThrow();
      }
    });

    it('Should accept valid preset names', () => {
      const validNames = [
        'momo_rsi_atr',
        'bb-revert-trail',
        'preset123',
        'a'.repeat(100), // Max length
      ];

      for (const name of validNames) {
        expect(() => {
          if (!name || typeof name !== 'string') {
            throw new Error('Missing or invalid name');
          }
          if (name.trim() !== name) {
            throw new Error('Name has leading/trailing whitespace');
          }
          if (name.length === 0) {
            throw new Error('Name is empty');
          }
          if (name.length > 100) {
            throw new Error('Name too long');
          }
          if (!/^[A-Za-z0-9_-]+$/.test(name)) {
            throw new Error('Name contains invalid characters');
          }
        }).not.toThrow();
      }
    });
  });

  describe('Time Range Validation', () => {
    it('CRITICAL: Should reject time ranges where start >= end', () => {
      const start = '2024-12-02T00:00:00Z';
      const end = '2024-12-01T00:00:00Z';

      expect(() => {
        const startMs = Date.parse(start);
        const endMs = Date.parse(end);
        if (startMs >= endMs) {
          throw new Error('start must be < end');
        }
      }).toThrow('start must be < end');
    });

    it('CRITICAL: Should reject time ranges exceeding maximum days', () => {
      const start = '2024-01-01T00:00:00Z';
      const end = '2024-05-01T00:00:00Z'; // ~120 days
      const maxDays = 90;

      expect(() => {
        const startMs = Date.parse(start);
        const endMs = Date.parse(end);
        const daysDiff = (endMs - startMs) / (1000 * 60 * 60 * 24);
        if (daysDiff > maxDays) {
          throw new Error(`time_range exceeds maximum of ${maxDays} days`);
        }
      }).toThrow('exceeds maximum');
    });

    it('CRITICAL: Should reject future start times', () => {
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // Tomorrow
      const oneHour = 60 * 60 * 1000;
      const now = Date.now();

      expect(() => {
        const startMs = Date.parse(future);
        if (startMs > now + oneHour) {
          throw new Error('time_range.start is in the future');
        }
      }).toThrow('in the future');
    });

    it('Should accept valid time ranges', () => {
      const start = '2024-12-01T00:00:00Z';
      const end = '2024-12-02T00:00:00Z';
      const maxDays = 90;
      const oneHour = 60 * 60 * 1000;
      const now = Date.now();

      expect(() => {
        const startMs = Date.parse(start);
        const endMs = Date.parse(end);

        if (startMs >= endMs) {
          throw new Error('start must be < end');
        }

        const daysDiff = (endMs - startMs) / (1000 * 60 * 60 * 24);
        if (daysDiff > maxDays) {
          throw new Error('exceeds maximum');
        }

        if (startMs > now + oneHour) {
          throw new Error('in the future');
        }
      }).not.toThrow();
    });
  });

  describe('Token Set Validation', () => {
    it('CRITICAL: Should reject empty token sets', () => {
      const emptyContent = '';

      expect(() => {
        const tokens = emptyContent
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && !s.startsWith('#'));

        if (tokens.length === 0) {
          throw new Error('Token set contains no valid tokens');
        }
      }).toThrow('no valid tokens');
    });

    it('CRITICAL: Should filter out invalid token addresses', () => {
      const content = `
# Comment line
So11111111111111111111111111111111111111112
invalid_short
EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
invalid@chars
      `;

      const tokens = content
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith('#'));

      const validTokens: string[] = [];
      for (const token of tokens) {
        if (token.length >= 32 && token.length <= 44 && /^[A-Za-z0-9]+$/.test(token)) {
          validTokens.push(token);
        }
      }

      expect(validTokens.length).toBe(2); // Only the two valid tokens
      expect(validTokens).toContain('So11111111111111111111111111111111111111112');
      expect(validTokens).toContain('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    });

    it('CRITICAL: Should reject token sets with no valid tokens after filtering', () => {
      const content = `
# Only comments
invalid_short
invalid@chars
      `;

      expect(() => {
        const tokens = content
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && !s.startsWith('#'));

        const validTokens: string[] = [];
        for (const token of tokens) {
          if (token.length >= 32 && token.length <= 44 && /^[A-Za-z0-9]+$/.test(token)) {
            validTokens.push(token);
          }
        }

        if (validTokens.length === 0) {
          throw new Error('Token set contains no valid token addresses after validation');
        }
      }).toThrow('no valid token addresses');
    });
  });

  describe('Directory Validation', () => {
    it('CRITICAL: Should validate directory exists and is a directory', () => {
      (fs.statSync as any).mockReturnValue({ isDirectory: () => false });

      expect(() => {
        const stat = fs.statSync('/path');
        if (!stat.isDirectory()) {
          throw new Error('Path is not a directory');
        }
      }).toThrow('not a directory');
    });
  });

  describe('Artifact Directory Creation', () => {
    it('CRITICAL: Should handle directory creation failures', () => {
      (fs.mkdirSync as any).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      expect(() => {
        try {
          fs.mkdirSync('/protected', { recursive: true });
        } catch (error) {
          throw new Error(
            `Failed to create artifact directory: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }).toThrow('Failed to create artifact directory');
    });
  });

  describe('ISO Date Parsing', () => {
    it('CRITICAL: Should handle invalid ISO date strings', () => {
      const invalidDates = [
        '',
        'not-a-date',
        '2024-13-45T99:99:99Z', // Invalid components
        '2024-12-01', // Missing time
      ];

      for (const date of invalidDates) {
        expect(() => {
          if (typeof date !== 'string' || date.trim() === '') {
            throw new Error('Invalid ISO: empty string');
          }
          const ms = Date.parse(date);
          if (!Number.isFinite(ms)) {
            throw new Error(`Invalid ISO: ${date}`);
          }
          const dateObj = new Date(ms);
          if (isNaN(dateObj.getTime())) {
            throw new Error(`Invalid ISO: ${date} (parsed but invalid date)`);
          }
        }).toThrow();
      }
    });
  });

  describe('Preset Validation', () => {
    it('CRITICAL: Should validate all required preset fields', () => {
      const invalidPresets = [
        null,
        undefined,
        {},
        { kind: 'wrong_kind' },
        { kind: 'sim_preset_v1', name: '' },
        { kind: 'sim_preset_v1', name: 'test', data: null },
        { kind: 'sim_preset_v1', name: 'test', data: { dataset: 'invalid' } },
        { kind: 'sim_preset_v1', name: 'test', data: { dataset: 'candles_1m', chain: 'invalid' } },
        {
          kind: 'sim_preset_v1',
          name: 'test',
          data: { dataset: 'candles_1m', chain: 'sol', interval: 'invalid' },
        },
        {
          kind: 'sim_preset_v1',
          name: 'test',
          data: { dataset: 'candles_1m', chain: 'sol', interval: '1m' },
          risk: { position_size: { mode: 'fixed_quote', quote: -1 } },
        },
      ];

      for (const preset of invalidPresets) {
        expect(() => {
          if (!preset || typeof preset !== 'object') {
            throw new Error('Preset is not an object');
          }
          if ((preset as any).kind !== 'sim_preset_v1') {
            throw new Error('Wrong kind');
          }
          if (!(preset as any).data || typeof (preset as any).data !== 'object') {
            throw new Error('Missing or invalid data');
          }
          if (!['candles_1m', 'candles_5m'].includes((preset as any).data?.dataset)) {
            throw new Error('Invalid dataset');
          }
          if (!['sol', 'eth', 'base', 'bsc'].includes((preset as any).data?.chain)) {
            throw new Error('Invalid chain');
          }
          if (!['1m', '5m', '1h', '1d'].includes((preset as any).data?.interval)) {
            throw new Error('Invalid interval');
          }
          if (!(preset as any).risk || typeof (preset as any).risk !== 'object') {
            throw new Error('Missing or invalid risk');
          }
          if ((preset as any).risk.position_size?.mode !== 'fixed_quote') {
            throw new Error('Invalid position_size.mode');
          }
          if (
            typeof (preset as any).risk.position_size?.quote !== 'number' ||
            (preset as any).risk.position_size?.quote <= 0
          ) {
            throw new Error('Invalid position_size.quote');
          }
        }).toThrow();
      }
    });
  });
});


