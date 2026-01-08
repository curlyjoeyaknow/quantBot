/**
 * Property Tests for Catalog Layout
 * ==================================
 *
 * Tests critical invariants for path generation and date partitioning.
 *
 * Critical Invariants:
 * 1. Paths are always valid filesystem paths (no invalid characters)
 * 2. Date partitioning preserves date information correctly
 * 3. Paths are deterministic (same inputs → same outputs)
 * 4. Token IDs are properly sanitized
 * 5. Date formats are consistent (ISO 8601)
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { getSliceFilePath, sanitizeTokenId } from '../../src/layout.js';

describe('Catalog Layout - Property Tests', () => {
  // Generate valid ISO 8601 date strings (simplified to avoid filter rejections)
  const isoDateArb = fc
    .record({
      year: fc.integer({ min: 2020, max: 2030 }),
      month: fc.integer({ min: 1, max: 12 }),
      day: fc.integer({ min: 1, max: 28 }), // Use 28 to avoid month-end issues
      hour: fc.integer({ min: 0, max: 23 }),
      minute: fc.integer({ min: 0, max: 59 }),
      second: fc.integer({ min: 0, max: 59 }),
    })
    .map(({ year, month, day, hour, minute, second }) => {
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}Z`;
    });

  // Generate valid Solana token addresses (simplified - just alphanumeric, no filter)
  const tokenAddressArb = fc.string({ minLength: 32, maxLength: 44 }).map((s) =>
    s
      .replace(/[^A-Za-z0-9]/g, 'A')
      .padEnd(32, 'A')
      .slice(0, 44)
  ); // Ensure valid chars

  // Generate valid catalog base paths (simplified)
  const catalogPathArb = fc.oneof(
    fc.constant('./catalog'),
    fc.constant('/var/catalog'),
    fc.constant('./test-catalog')
  );

  describe('Path Generation - Determinism (Critical Invariant)', () => {
    it('should generate identical paths for identical inputs', () => {
      fc.assert(
        fc.property(
          tokenAddressArb,
          isoDateArb,
          isoDateArb,
          catalogPathArb,
          fc.boolean(),
          (tokenId, startIso, endIso, catalogBasePath, useDatePartitioning) => {
            // Ensure end is after start
            if (endIso <= startIso) {
              return true; // Skip invalid inputs
            }

            const path1 = getSliceFilePath(
              tokenId,
              startIso,
              endIso,
              catalogBasePath,
              useDatePartitioning
            );
            const path2 = getSliceFilePath(
              tokenId,
              startIso,
              endIso,
              catalogBasePath,
              useDatePartitioning
            );

            return path1 === path2;
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('Path Validity (Critical Invariant)', () => {
    it('should generate paths without invalid filesystem characters', () => {
      fc.assert(
        fc.property(
          tokenAddressArb,
          isoDateArb,
          isoDateArb,
          catalogPathArb,
          fc.boolean(),
          (tokenId, startIso, endIso, catalogBasePath, useDatePartitioning) => {
            if (endIso <= startIso) {
              return true;
            }

            const path = getSliceFilePath(
              tokenId,
              startIso,
              endIso,
              catalogBasePath,
              useDatePartitioning
            );

            // Path should not contain null bytes, control characters, or invalid path separators
            return (
              !path.includes('\0') &&
              !path.includes('\n') &&
              !path.includes('\r') &&
              !path.includes('\t') &&
              path.length > 0
            );
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should always end with .parquet extension', () => {
      fc.assert(
        fc.property(
          tokenAddressArb,
          isoDateArb,
          isoDateArb,
          catalogPathArb,
          fc.boolean(),
          (tokenId, startIso, endIso, catalogBasePath, useDatePartitioning) => {
            if (endIso <= startIso) {
              return true;
            }

            const path = getSliceFilePath(
              tokenId,
              startIso,
              endIso,
              catalogBasePath,
              useDatePartitioning
            );

            return path.endsWith('.parquet');
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('Date Partitioning (Critical Invariant)', () => {
    it('should include date partition when enabled', () => {
      fc.assert(
        fc.property(
          tokenAddressArb,
          isoDateArb,
          isoDateArb,
          catalogPathArb,
          (tokenId, startIso, endIso, catalogBasePath) => {
            if (endIso <= startIso) {
              return true;
            }

            const pathWithPartition = getSliceFilePath(
              tokenId,
              startIso,
              endIso,
              catalogBasePath,
              true
            );

            // Extract date from ISO string (YYYY-MM-DD)
            const datePart = startIso.split('T')[0];

            // Path should contain the date partition
            return pathWithPartition.includes(datePart);
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should use start date for partitioning (not end date)', () => {
      fc.assert(
        fc.property(
          tokenAddressArb,
          isoDateArb,
          isoDateArb,
          catalogPathArb,
          (tokenId, startIso, endIso, catalogBasePath) => {
            if (endIso <= startIso) {
              return true;
            }

            const startDate = startIso.split('T')[0];
            const endDate = endIso.split('T')[0];

            // Only test if dates are different
            if (startDate === endDate) {
              return true;
            }

            const path = getSliceFilePath(tokenId, startIso, endIso, catalogBasePath, true);

            // Should use start date, not end date
            return path.includes(startDate) && !path.includes(endDate);
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('Token ID Sanitization (Critical Invariant)', () => {
    it('should sanitize token IDs to valid filesystem names', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }), // Any string, including special chars
          (tokenId) => {
            const sanitized = sanitizeTokenId(tokenId);

            // Sanitized should not contain path separators or invalid characters
            return (
              !sanitized.includes('/') &&
              !sanitized.includes('\\') &&
              !sanitized.includes('\0') &&
              sanitized.length > 0
            );
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should preserve alphanumeric characters', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => /^[A-Za-z0-9]+$/.test(s)),
          (tokenId) => {
            const sanitized = sanitizeTokenId(tokenId);
            // Alphanumeric-only strings should be unchanged
            return sanitized === tokenId;
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});
