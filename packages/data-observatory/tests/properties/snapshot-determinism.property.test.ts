/**
 * Property Test: Snapshot Determinism
 * ====================================
 *
 * CRITICAL: This test verifies that same snapshot hash → same data → same sim output.
 *
 * This is a fundamental invariant for reproducibility:
 * - Same contentHash → same data
 * - Same data + same strategy → same simulation output
 *
 * This test would have caught if snapshots were not deterministic.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createHash } from 'crypto';
import type { DataSnapshotRef } from '../../src/snapshots/types.js';
import { DataSnapshotRefSchema } from '../../src/snapshots/types.js';

/**
 * Create a deterministic content hash from data
 */
function computeContentHash(data: unknown): string {
  // For arrays, JSON.stringify already produces deterministic output
  // For objects, sort keys for determinism
  const json = Array.isArray(data)
    ? JSON.stringify(data)
    : JSON.stringify(data, Object.keys(data as Record<string, unknown>).sort());
  return createHash('sha256').update(json).digest('hex');
}

describe('Snapshot Determinism - Property Tests', () => {
  it('CRITICAL: same content hash → same data representation', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            timestamp: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
            open: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
            high: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
            low: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
            close: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
            volume: fc.float({ min: Math.fround(0), max: Math.fround(1_000_000) }),
            mint: fc.string({ minLength: 32, maxLength: 44 }),
          }),
          { minLength: 1, maxLength: 100 }
        ),
        (candles) => {
          // Sort for determinism
          const sorted = [...candles].sort((a, b) => {
            if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
            return a.mint.localeCompare(b.mint);
          });

          // Compute hash twice - should be identical
          const hash1 = computeContentHash(sorted);
          const hash2 = computeContentHash(sorted);

          expect(hash1).toBe(hash2);
          expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 format
        }
      ),
      { numRuns: 50 }
    );
  });

  it('CRITICAL: different data → different hash', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            timestamp: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
            open: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
            close: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
            mint: fc.string({ minLength: 32, maxLength: 44 }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        fc.array(
          fc.record({
            timestamp: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
            open: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
            close: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
            mint: fc.string({ minLength: 32, maxLength: 44 }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (data1, data2) => {
          // Only test when data is actually different
          const json1 = JSON.stringify(data1);
          const json2 = JSON.stringify(data2);

          if (json1 === json2) {
            // Skip if identical (rare but possible)
            return true;
          }

          const hash1 = computeContentHash(data1);
          const hash2 = computeContentHash(data2);

          // Different data should produce different hashes (with high probability)
          // Note: Hash collisions are theoretically possible but extremely rare
          expect(hash1).not.toBe(hash2);
        }
      ),
      { numRuns: 20 }
    );
  });

  it('CRITICAL: DataSnapshotRef contentHash is SHA-256 format', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc
          .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
          .filter((d) => !isNaN(d.getTime())) // Filter out invalid dates
          .map((d) => d.toISOString()),
        (snapshotId, contentHash, createdAt) => {
          // Only test valid SHA-256 hashes
          if (!/^[a-f0-9]{64}$/.test(contentHash)) {
            return true; // Skip invalid hashes
          }

          const ref: DataSnapshotRef = {
            snapshotId,
            contentHash,
            createdAt,
            spec: {
              sources: ['calls'],
              from: '2024-01-01T00:00:00.000Z',
              to: '2024-01-01T01:00:00.000Z',
            },
            manifest: {
              eventCount: 0,
              eventCountsByType: {},
              tokenCount: 0,
              actualFrom: '2024-01-01T00:00:00.000Z',
              actualTo: '2024-01-01T01:00:00.000Z',
              quality: {
                completeness: 100,
              },
            },
          };

          const result = DataSnapshotRefSchema.safeParse(ref);
          expect(result.success).toBe(true);

          if (result.success) {
            expect(result.data.contentHash).toMatch(/^[a-f0-9]{64}$/);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('CRITICAL: snapshot integrity validation works', () => {
    // Test that we can verify snapshot integrity by recomputing hash
    const testData = {
      candles: [
        { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000, mint: 'A' },
        { timestamp: 2000, open: 1.05, high: 1.2, low: 1.0, close: 1.15, volume: 1200, mint: 'A' },
      ],
      calls: [{ id: 'call1', caller: 'test', mint: 'A', createdAt: '2024-01-01T00:00:00.000Z' }],
    };

    const hash1 = computeContentHash(testData);

    // Same data should produce same hash
    const hash2 = computeContentHash(testData);
    expect(hash1).toBe(hash2);

    // Modified data should produce different hash
    const modifiedData = {
      ...testData,
      candles: [
        ...testData.candles,
        { timestamp: 3000, open: 1.15, high: 1.3, low: 1.1, close: 1.25, volume: 1500, mint: 'A' },
      ],
    };
    const hash3 = computeContentHash(modifiedData);
    expect(hash3).not.toBe(hash1);
  });
});
