/**
 * Fuzzing Tests for Overlay Parser
 * =================================
 *
 * Tests overlay parser robustness against malformed JSON input:
 * - Never crashes on garbage input
 * - Handles malformed overlay structures gracefully
 * - Prevents injection attacks
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { loadOverlaySetsFromFile } from '../../src/commands/calls/_overlays.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Helper to create a temporary file with content for testing
 */
function createTempFile(content: string): string {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `overlay-test-${Date.now()}-${Math.random().toString(36).substring(7)}.json`);
  fs.writeFileSync(tmpFile, content, 'utf8');
  return tmpFile;
}

describe('Overlay Parser - Fuzzing Tests', () => {
  describe('loadOverlaySetsFromFile - Malformed JSON', () => {
    it('never crashes on arbitrary JSON strings', () => {
      fc.assert(
        fc.property(fc.string({ maxLength: 10000 }), (jsonString) => {
          const tmpFile = createTempFile(jsonString);
          try {
            try {
              loadOverlaySetsFromFile(tmpFile);
              return true; // Parsed successfully
            } catch (error) {
              // Must throw Error, not crash
              return error instanceof Error && error.message.length > 0;
            }
          } finally {
            // Cleanup
            try {
              fs.unlinkSync(tmpFile);
            } catch {
              // Ignore cleanup errors
            }
          }
        }),
        { numRuns: 500 } // Reduced from 1000 since we're creating files
      );
    });

    it('handles malformed overlay structures gracefully', () => {
      const malformedCases = [
        '{}', // Empty object
        '[]', // Empty array
        'null', // Null
        '{"invalid": "structure"}', // Wrong shape
        '{"overlays": "not an array"}', // Wrong type
        '{"overlays": []}', // Empty overlays array
        '[{"not": "an overlay"}]', // Invalid overlay object
        '[{"kind": "invalid_kind"}]', // Invalid kind
        '[{"kind": "take_profit"}]', // Missing required fields
        '{"sets": "not an array"}', // Invalid sets type
        '{"sets": []}', // Empty sets
        '[{"id": "set-1"}]', // Missing overlays
        '[{"overlays": "not an array"}]', // Invalid overlays type
      ];

      malformedCases.forEach((json) => {
        const tmpFile = createTempFile(json);
        try {
          expect(() => loadOverlaySetsFromFile(tmpFile)).toThrow(); // Should throw Error, not crash
        } finally {
          try {
            fs.unlinkSync(tmpFile);
          } catch {
            // Ignore cleanup errors
          }
        }
      });
    });

    it('handles injection attempts safely', () => {
      const injectionCases = [
        '{"__proto__": {"polluted": true}}',
        '{"sets": [{"__proto__": {"polluted": true}, "id": "set-1", "overlays": []}]}',
        '{"sets": [{"id": "<script>alert(1)</script>", "overlays": []}]}',
        '{"sets": [{"id": "set-1", "overlays": [{"kind": "take_profit", "takePct": "<script>alert(1)</script>"}]}]}',
      ];

      injectionCases.forEach((json) => {
        const tmpFile = createTempFile(json);
        try {
          // Should either parse or throw Error, never crash or execute code
          try {
            const result = loadOverlaySetsFromFile(tmpFile);
            expect(Array.isArray(result)).toBe(true);
          } catch (error) {
            expect(error).toBeInstanceOf(Error);
          }
          // Verify no code execution happened
          expect((global as any).polluted).toBeUndefined();
        } finally {
          try {
            fs.unlinkSync(tmpFile);
          } catch {
            // Ignore cleanup errors
          }
        }
      });
    });

    it('handles very large overlay files', () => {
      // Create a large but valid overlay set
      const largeOverlays = Array.from({ length: 1000 }, (_, i) => ({
        kind: 'take_profit',
        takePct: 100 + i,
      }));
      const largeConfig = JSON.stringify(largeOverlays);

      const tmpFile = createTempFile(largeConfig);
      try {
        const result = loadOverlaySetsFromFile(tmpFile);
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(1); // Single set created
        expect(result[0]?.overlays.length).toBe(1000);
      } finally {
        try {
          fs.unlinkSync(tmpFile);
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('handles special characters in overlay IDs', () => {
      const specialCases = [
        JSON.stringify([{ id: 'set-🚀', overlays: [{ kind: 'take_profit', takePct: 100 }] }]),
        JSON.stringify([{ id: 'set-with\n-newline', overlays: [{ kind: 'take_profit', takePct: 100 }] }]),
        JSON.stringify([{ id: 'set-with-unicode-\\u2028', overlays: [{ kind: 'take_profit', takePct: 100 }] }]),
      ];

      specialCases.forEach((json) => {
        const tmpFile = createTempFile(json);
        try {
          expect(() => loadOverlaySetsFromFile(tmpFile)).not.toThrow(/crash|panic/i);
        } finally {
          try {
            fs.unlinkSync(tmpFile);
          } catch {
            // Ignore cleanup errors
          }
        }
      });
    });
  });
});

