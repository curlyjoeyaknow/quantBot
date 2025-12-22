/**
 * Determinism Contract
 *
 * Core types and interfaces for ensuring deterministic, replayable simulations.
 * All simulations must be:
 * - Seeded (same seed → same results)
 * - Versioned (inputs include version fields)
 * - Replayable (same inputs + seed → byte-identical outputs)
 */

import { z } from 'zod';

/**
 * Deterministic random number generator interface
 *
 * Replaces Math.random() to ensure seeded, deterministic randomness.
 */
export interface DeterministicRNG {
  /**
   * Generate next random number in [0, 1)
   */
  next(): number;

  /**
   * Generate next random integer in [min, max] (inclusive)
   */
  nextInt(min: number, max: number): number;

  /**
   * Generate next random float in [min, max)
   */
  nextFloat(min: number, max: number): number;

  /**
   * Get current seed (for debugging/reproducibility)
   */
  getSeed(): number;

  /**
   * Clone RNG state (for creating independent streams)
   */
  clone(): DeterministicRNG;
}

/**
 * Seeded random number generator using xorshift128+
 *
 * Fast, deterministic, good statistical properties.
 * Based on: https://en.wikipedia.org/wiki/Xorshift
 */
export class SeededRNG implements DeterministicRNG {
  private state0: number;
  private state1: number;

  constructor(seed: number) {
    // Initialize state from seed (use splitmix64-like algorithm)
    let s = BigInt(seed);
    // eslint-disable-next-line no-loss-of-precision
    s = (s + BigInt(0x9e3779b97f4a7c15)) & BigInt(0xffffffffffffffff);
    let t = s;
    // eslint-disable-next-line no-loss-of-precision
    t = (t ^ (t >> BigInt(30))) * BigInt(0xbf58476d1ce4e5b9);
    // eslint-disable-next-line no-loss-of-precision
    t = (t ^ (t >> BigInt(27))) * BigInt(0x94d049bb133111eb);
    t = t ^ (t >> BigInt(31));

    this.state0 = Number(t & BigInt(0xffffffff));
    this.state1 = Number((t >> BigInt(32)) & BigInt(0xffffffff));

    // Ensure state is non-zero
    if (this.state0 === 0 && this.state1 === 0) {
      this.state0 = 1;
      this.state1 = 1;
    }
  }

  next(): number {
    let s1 = BigInt(this.state0);
    const s0 = BigInt(this.state1);

    s1 = s1 ^ (s1 << BigInt(23));
    s1 = s1 ^ (s0 ^ (s0 >> BigInt(17)) ^ (s1 >> BigInt(26)));

    this.state1 = Number(s0);
    this.state0 = Number(s1 & BigInt(0xffffffff));

    // Convert to float in [0, 1)
    const result = Number((s1 + s0) & BigInt(0x1fffffffffffff)) / Number(BigInt(0x1fffffffffffff));
    return result;
  }

  nextInt(min: number, max: number): number {
    const range = max - min + 1;
    return min + Math.floor(this.next() * range);
  }

  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  getSeed(): number {
    // Return a hash of current state (for debugging)
    return (this.state0 * 31) ^ (this.state1 * 17);
  }

  clone(): DeterministicRNG {
    const cloned = Object.create(SeededRNG.prototype);
    cloned.state0 = this.state0;
    cloned.state1 = this.state1;
    return cloned;
  }
}

/**
 * Determinism contract schema
 *
 * Ensures all simulation inputs include version information and seed.
 */
export const DeterminismContractSchema = z.object({
  /**
   * Version of the simulation contract/engine
   */
  contractVersion: z.string().default('1.0.0'),

  /**
   * Random seed for deterministic execution
   * Same seed + same inputs → same outputs
   */
  seed: z.number().int().optional(),

  /**
   * Version of input data schema
   */
  dataVersion: z.string().optional(),

  /**
   * Version of strategy definition
   */
  strategyVersion: z.string().optional(),

  /**
   * Hash of inputs for reproducibility checks
   */
  inputHash: z.string().optional(),
});

export type DeterminismContract = z.infer<typeof DeterminismContractSchema>;

/**
 * Create a deterministic RNG from a seed
 *
 * If seed is not provided, generates one from the current timestamp.
 * For reproducibility, always provide an explicit seed.
 */
export function createDeterministicRNG(seed?: number): DeterministicRNG {
  const actualSeed = seed ?? Date.now();
  return new SeededRNG(actualSeed);
}

/**
 * Generate a deterministic seed from a string
 *
 * Useful for generating seeds from run IDs, strategy names, etc.
 */
export function seedFromString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}
