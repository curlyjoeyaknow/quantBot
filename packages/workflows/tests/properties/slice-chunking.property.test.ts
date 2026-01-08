/**
 * Property Tests for Slice Chunking Logic
 * =======================================
 *
 * Tests critical invariants for time window chunking in exportSlicesForAlerts.
 *
 * Critical Invariants:
 * 1. Chunks cover the entire time window (no gaps)
 * 2. Chunks do not overlap
 * 3. Chunks are ordered (start times are monotonic)
 * 4. All chunks are within the original time window
 * 5. Chunk duration never exceeds maxHoursPerChunk
 * 6. Last chunk ends at or before window end
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { DateTime } from 'luxon';

/**
 * Generate chunks for a time window (simulating exportSlicesForAlerts logic)
 */
function generateChunks(
  windowStart: DateTime,
  windowEnd: DateTime,
  maxHoursPerChunk: number
): Array<{ start: DateTime; end: DateTime }> {
  const totalHours = windowEnd.diff(windowStart, 'hours').hours;
  const needsChunking = totalHours > maxHoursPerChunk;

  if (!needsChunking) {
    return [{ start: windowStart, end: windowEnd }];
  }

  const chunks: Array<{ start: DateTime; end: DateTime }> = [];
  const chunkHours = maxHoursPerChunk;
  let currentStart = windowStart;

  while (currentStart < windowEnd) {
    const currentEnd = DateTime.min(currentStart.plus({ hours: chunkHours }), windowEnd);
    chunks.push({ start: currentStart, end: currentEnd });
    currentStart = currentEnd;
  }

  return chunks;
}

describe('Slice Chunking - Property Tests', () => {
  // Generate valid DateTime ranges
  const dateTimeArb = fc
    .record({
      year: fc.integer({ min: 2020, max: 2030 }),
      month: fc.integer({ min: 1, max: 12 }),
      day: fc.integer({ min: 1, max: 28 }),
      hour: fc.integer({ min: 0, max: 23 }),
      minute: fc.integer({ min: 0, max: 59 }),
    })
    .map(({ year, month, day, hour, minute }) => {
      return DateTime.fromObject({ year, month, day, hour, minute });
    });

  const maxHoursPerChunkArb = fc.integer({ min: 1, max: 24 });

  describe('Complete Coverage (Critical Invariant)', () => {
    it('should cover entire time window without gaps', () => {
      fc.assert(
        fc.property(dateTimeArb, dateTimeArb, maxHoursPerChunkArb, (start, end, maxHours) => {
          // Ensure end is after start
          if (end <= start) {
            return true;
          }

          const chunks = generateChunks(start, end, maxHours);

          if (chunks.length === 0) {
            return false;
          }

          // First chunk should start at window start
          const firstChunk = chunks[0];
          if (firstChunk.start.toMillis() !== start.toMillis()) {
            return false;
          }

          // Last chunk should end at window end
          const lastChunk = chunks[chunks.length - 1];
          if (lastChunk.end.toMillis() !== end.toMillis()) {
            return false;
          }

          // Check for gaps between chunks
          for (let i = 0; i < chunks.length - 1; i++) {
            const currentEnd = chunks[i].end.toMillis();
            const nextStart = chunks[i + 1].start.toMillis();

            if (currentEnd !== nextStart) {
              return false; // Gap found
            }
          }

          return true;
        }),
        { numRuns: 30 }
      );
    });
  });

  describe('No Overlaps (Critical Invariant)', () => {
    it('should never create overlapping chunks', () => {
      fc.assert(
        fc.property(dateTimeArb, dateTimeArb, maxHoursPerChunkArb, (start, end, maxHours) => {
          if (end <= start) {
            return true;
          }

          const chunks = generateChunks(start, end, maxHours);

          // Optimized: Check adjacent chunks only (if chunks are ordered and non-overlapping,
          // then adjacent chunks being non-overlapping implies all chunks are non-overlapping)
          for (let i = 0; i < chunks.length - 1; i++) {
            const current = chunks[i];
            const next = chunks[i + 1];

            // Adjacent chunks should not overlap (current.end should equal next.start)
            if (current.end.toMillis() > next.start.toMillis()) {
              return false; // Overlap found
            }
          }

          return true;
        }),
        { numRuns: 30, timeout: 10000 } // Add timeout and reduce runs
      );
    });
  });

  describe('Chunk Duration (Critical Invariant)', () => {
    it('should never exceed maxHoursPerChunk', () => {
      fc.assert(
        fc.property(dateTimeArb, dateTimeArb, maxHoursPerChunkArb, (start, end, maxHours) => {
          if (end <= start) {
            return true;
          }

          const chunks = generateChunks(start, end, maxHours);

          for (const chunk of chunks) {
            const durationHours = chunk.end.diff(chunk.start, 'hours').hours;

            // Duration should not exceed maxHoursPerChunk
            // Allow small floating point tolerance
            if (durationHours > maxHours + 0.001) {
              return false;
            }
          }

          return true;
        }),
        { numRuns: 30 }
      );
    });
  });

  describe('Chunk Ordering (Critical Invariant)', () => {
    it('should generate chunks in chronological order', () => {
      fc.assert(
        fc.property(dateTimeArb, dateTimeArb, maxHoursPerChunkArb, (start, end, maxHours) => {
          if (end <= start) {
            return true;
          }

          const chunks = generateChunks(start, end, maxHours);

          // Check that chunks are ordered
          for (let i = 0; i < chunks.length - 1; i++) {
            if (chunks[i].start >= chunks[i + 1].start) {
              return false;
            }
            if (chunks[i].end > chunks[i + 1].end) {
              return false;
            }
          }

          return true;
        }),
        { numRuns: 30 }
      );
    });
  });

  describe('Boundary Conditions', () => {
    it('should handle single chunk case correctly', () => {
      fc.assert(
        fc.property(dateTimeArb, maxHoursPerChunkArb, (start, maxHours) => {
          // Create a window smaller than maxHours
          const end = start.plus({ hours: maxHours - 0.5 });

          const chunks = generateChunks(start, end, maxHours);

          // Should generate exactly one chunk
          return chunks.length === 1 && chunks[0].start.equals(start) && chunks[0].end.equals(end);
        }),
        { numRuns: 30 }
      );
    });

    it('should handle exact maxHoursPerChunk boundaries', () => {
      fc.assert(
        fc.property(dateTimeArb, maxHoursPerChunkArb, (start, maxHours) => {
          // Create a window exactly equal to maxHours
          const end = start.plus({ hours: maxHours });

          const chunks = generateChunks(start, end, maxHours);

          // Should generate exactly one chunk (boundary case)
          return chunks.length === 1;
        }),
        { numRuns: 30 }
      );
    });
  });
});
