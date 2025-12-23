/**
 * Unified Validation and Coercion Pipeline
 *
 * Single source of truth for all CLI argument validation and coercion.
 * This ensures consistent behavior across all commands and prevents
 * validation logic from being scattered across handlers.
 *
 * Flow:
 * 1. Normalize options (Commander.js → flat object)
 * 2. Coerce types (string → number/boolean/date)
 * 3. Validate with Zod schema
 * 4. Return typed, validated arguments
 */

import { z } from 'zod';
import { normalizeOptions } from './argument-parser.js';
import { parseArguments } from './argument-parser.js';

/**
 * Unified validation and coercion pipeline
 *
 * This is the ONLY path for CLI argument validation.
 * All commands must use this function to ensure consistency.
 *
 * @param schema - Zod schema for validation
 * @param rawOptions - Raw options from Commander.js
 * @returns Validated and coerced arguments matching the schema
 * @throws ValidationError if validation fails
 */
export function validateAndCoerceArgs<T extends z.ZodSchema>(
  schema: T,
  rawOptions: Record<string, unknown>
): z.infer<T> {
  // Step 1: Normalize options (handles --flag value and --flag=value)
  const normalized = normalizeOptions(rawOptions);

  // Step 2 & 3: Parse and validate with Zod (coercion happens in normalizeOptions)
  // This is the single validation path - all validation logic is centralized here
  return parseArguments(schema, normalized);
}

/**
 * Validate that a command uses the unified validation pipeline
 *
 * This is a development-time check to ensure handlers don't bypass
 * the validation pipeline.
 *
 * @param handler - Handler function to check
 * @returns True if handler appears to use validation pipeline correctly
 */
export function validateHandlerUsesPipeline(handler: unknown): boolean {
  // This is a best-effort check - we can't statically verify all cases
  // The real enforcement is through code review and ESLint rules
  if (typeof handler !== 'function') {
    return false;
  }

  // Check if handler source code contains direct Zod parsing (bypassing pipeline)
  const handlerSource = handler.toString();
  const hasDirectZodParse = /\.parse\s*\(/.test(handlerSource);
  const hasDirectNormalize = /normalizeOptions\s*\(/.test(handlerSource);

  // If handler directly calls Zod.parse or normalizeOptions, it's bypassing the pipeline
  // (This is a heuristic - false positives are possible but unlikely)
  return !hasDirectZodParse && !hasDirectNormalize;
}
