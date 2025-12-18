/**
 * Golden Fixtures Test
 *
 * Tests TypeScript simulator against golden fixtures.
 * Ensures simulator produces expected results on canonical test cases.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { simulateFromInput } from '../../../src/core/contract-adapter';
import { SimInputSchema, SimResultSchema } from '../../../src/types/contracts';
import type { SimInput, SimResult } from '../../../src/types/contracts';

// CommonJS __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, '../../../../tools/telegram/tests/fixtures');

describe('Golden Fixtures', () => {
  const inputs = JSON.parse(readFileSync(join(fixturesDir, 'golden_sim_inputs.json'), 'utf8'));
  const expected = JSON.parse(readFileSync(join(fixturesDir, 'golden_sim_results.json'), 'utf8'));

  // Create a map of expected results by name
  const expectedMap = new Map(
    expected.map((e: { name: string; expected_result: SimResult }) => [e.name, e.expected_result])
  );

  it.each(inputs.map((input: SimInput & { name: string }, i: number) => [input.name, input]))(
    'should match golden fixture: %s',
    async (name: string, inputData: SimInput & { name: string }) => {
      // Remove name from input
      const { name: _, ...input } = inputData;

      // Validate and parse input
      const input_parsed = SimInputSchema.parse(input);

      // Run simulation
      const result = await simulateFromInput(input_parsed);

      // Validate result schema
      const validatedResult = SimResultSchema.parse(result);

      // Check if we have expected result for this fixture
      const expectedResult = expectedMap.get(name);
      if (expectedResult) {
        // Compare with expected (within tolerance)
        expect(validatedResult.final_pnl).toBeCloseTo(expectedResult.final_pnl, 2);
        expect(validatedResult.events.length).toBeGreaterThanOrEqual(expectedResult.events.length);
        expect(validatedResult.entry_price).toBeCloseTo(expectedResult.entry_price, 2);
        expect(validatedResult.final_price).toBeCloseTo(expectedResult.final_price, 2);
      } else {
        // No expected result, just verify it's valid
        expect(validatedResult.run_id).toBe(input_parsed.run_id);
        expect(validatedResult.total_candles).toBe(input_parsed.candles.length);
      }
    }
  );
});
