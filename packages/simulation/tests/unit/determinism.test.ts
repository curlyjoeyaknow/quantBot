/**
 * Determinism Tests
 *
 * Verifies that simulations are deterministic:
 * - Same inputs + same seed → same outputs
 * - Different seeds → different but deterministic outputs
 */

import { describe, it, expect } from 'vitest';
import { createDeterministicRNG, seedFromString, type DeterministicRNG } from '@quantbot/core';

describe('DeterministicRNG', () => {
  describe('same seed produces same sequence', () => {
    it('generates identical sequences with same seed', () => {
      const seed = 42;
      const rng1 = createDeterministicRNG(seed);
      const rng2 = createDeterministicRNG(seed);

      const sequence1: number[] = [];
      const sequence2: number[] = [];

      for (let i = 0; i < 100; i++) {
        sequence1.push(rng1.next());
        sequence2.push(rng2.next());
      }

      expect(sequence1).toEqual(sequence2);
    });

    it('generates different sequences with different seeds', () => {
      const rng1 = createDeterministicRNG(42);
      const rng2 = createDeterministicRNG(43);

      const sequence1: number[] = [];
      const sequence2: number[] = [];

      for (let i = 0; i < 100; i++) {
        sequence1.push(rng1.next());
        sequence2.push(rng2.next());
      }

      expect(sequence1).not.toEqual(sequence2);
    });
  });

  describe('nextInt', () => {
    it('generates integers in specified range', () => {
      const rng = createDeterministicRNG(42);
      const min = 1;
      const max = 10;

      for (let i = 0; i < 100; i++) {
        const value = rng.nextInt(min, max);
        expect(value).toBeGreaterThanOrEqual(min);
        expect(value).toBeLessThanOrEqual(max);
        expect(Number.isInteger(value)).toBe(true);
      }
    });

    it('generates deterministic sequence', () => {
      const seed = 42;
      const rng1 = createDeterministicRNG(seed);
      const rng2 = createDeterministicRNG(seed);

      const sequence1: number[] = [];
      const sequence2: number[] = [];

      for (let i = 0; i < 100; i++) {
        sequence1.push(rng1.nextInt(1, 10));
        sequence2.push(rng2.nextInt(1, 10));
      }

      expect(sequence1).toEqual(sequence2);
    });
  });

  describe('nextFloat', () => {
    it('generates floats in specified range', () => {
      const rng = createDeterministicRNG(42);
      const min = 0;
      const max = 100;

      for (let i = 0; i < 100; i++) {
        const value = rng.nextFloat(min, max);
        expect(value).toBeGreaterThanOrEqual(min);
        expect(value).toBeLessThan(max);
      }
    });

    it('generates deterministic sequence', () => {
      const seed = 42;
      const rng1 = createDeterministicRNG(seed);
      const rng2 = createDeterministicRNG(seed);

      const sequence1: number[] = [];
      const sequence2: number[] = [];

      for (let i = 0; i < 100; i++) {
        sequence1.push(rng1.nextFloat(0, 100));
        sequence2.push(rng2.nextFloat(0, 100));
      }

      expect(sequence1).toEqual(sequence2);
    });
  });

  describe('clone', () => {
    it('creates independent RNG stream', () => {
      const rng1 = createDeterministicRNG(42);
      const rng2 = rng1.clone();

      // Both should produce same sequence initially
      expect(rng1.next()).toBe(rng2.next());

      // But they're independent
      const val1 = rng1.next();
      const val2 = rng2.next();
      expect(val1).toBe(val2); // Same seed, same position

      // Advance one, other doesn't change
      const val3 = rng1.next();
      expect(rng2.next()).not.toBe(val3); // rng2 is still at previous position
    });
  });
});

describe('seedFromString', () => {
  it('generates same seed for same string', () => {
    const str = 'test-string-123';
    const seed1 = seedFromString(str);
    const seed2 = seedFromString(str);

    expect(seed1).toBe(seed2);
  });

  it('generates different seeds for different strings', () => {
    const seed1 = seedFromString('test-1');
    const seed2 = seedFromString('test-2');

    expect(seed1).not.toBe(seed2);
  });

  it('generates deterministic seeds from run IDs', () => {
    const runId1 = 'exp-20250123-123456';
    const runId2 = 'exp-20250123-123456';

    const seed1 = seedFromString(runId1);
    const seed2 = seedFromString(runId2);

    expect(seed1).toBe(seed2);
  });
});

describe('Determinism Contract', () => {
  it('same inputs + same seed → deterministic RNG sequences', () => {
    const seed = seedFromString('test-run-1');

    const rng1 = createDeterministicRNG(seed);
    const rng2 = createDeterministicRNG(seed);

    // Simulate using RNG in simulation (example: slippage, latency)
    const values1: number[] = [];
    const values2: number[] = [];

    for (let i = 0; i < 50; i++) {
      values1.push(rng1.next());
      values2.push(rng2.next());
    }

    expect(values1).toEqual(values2);
  });

  it('different seeds → different but deterministic sequences', () => {
    const seed1 = seedFromString('test-run-1');
    const seed2 = seedFromString('test-run-2');

    const rng1 = createDeterministicRNG(seed1);
    const rng2 = createDeterministicRNG(seed2);

    const values1: number[] = [];
    const values2: number[] = [];

    for (let i = 0; i < 50; i++) {
      values1.push(rng1.next());
      values2.push(rng2.next());
    }

    // Different seeds produce different sequences
    expect(values1).not.toEqual(values2);

    // But both are deterministic (re-run gives same result)
    const rng1Again = createDeterministicRNG(seed1);
    const rng2Again = createDeterministicRNG(seed2);

    const values1Again: number[] = [];
    const values2Again: number[] = [];

    for (let i = 0; i < 50; i++) {
      values1Again.push(rng1Again.next());
      values2Again.push(rng2Again.next());
    }

    expect(values1Again).toEqual(values1);
    expect(values2Again).toEqual(values2);
  });
});
