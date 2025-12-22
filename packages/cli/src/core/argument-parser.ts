/**
 * Argument Parser - Zod-based validation and parsing
 */

import { z } from 'zod';
import { ValidationError } from '@quantbot/utils';
import { validateMintAddress as validateMintAddressImpl } from './address-validator.js';

/**
 * Parse and validate arguments using Zod schema
 */
export function parseArguments<T extends z.ZodSchema>(
  schema: T,
  rawArgs: Record<string, unknown>
): z.infer<T> {
  try {
    return schema.parse(rawArgs);
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Format Zod errors into user-friendly messages
      const messages = error.issues.map((issue) => {
        const path = issue.path.join('.');
        return `  ${path}: ${issue.message}`;
      });

      throw new ValidationError(`Invalid arguments:\n${messages.join('\n')}`, {
        issues: error.issues,
        formattedMessages: messages,
      });
    }
    throw error;
  }
}

/**
 * Normalize Commander.js options to a flat object
 * Handles both --flag value and --flag=value formats
 *
 * IMPORTANT: Do NOT rename keys. Commander.js already converts --output-db to outputDb.
 * This function only normalizes VALUES (parsing, coercion, defaults).
 *
 * Value normalization:
 * - String "true"/"false" → boolean
 * - String numbers → number (if pure numeric)
 * - All other values → preserved as-is
 */
export function normalizeOptions(options: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(options)) {
    // Handle undefined/null values
    if (value === undefined || value === null) {
      continue;
    }

    // DO NOT rename keys - Commander.js already handles kebab-case → camelCase conversion
    // Keep the key as-is (Commander produces camelCase properties)
    const normalizedKey = key;

    // Handle string values that might be numbers or booleans
    if (typeof value === 'string') {
      // Try to parse as boolean
      if (value === 'true') {
        normalized[normalizedKey] = true;
      } else if (value === 'false') {
        normalized[normalizedKey] = false;
      } else if (!isNaN(Number(value)) && value.trim() !== '') {
        // Try to parse as number (but preserve if it's a file path or other non-numeric string)
        // Only convert if it's a pure number string
        const numValue = Number(value);
        if (String(numValue) === value.trim()) {
          normalized[normalizedKey] = numValue;
        } else {
          normalized[normalizedKey] = value;
        }
      } else {
        normalized[normalizedKey] = value;
      }
    } else {
      normalized[normalizedKey] = value;
    }
  }

  return normalized;
}

/**
 * Parse date strings to DateTime objects (for Luxon compatibility)
 */
export function parseDate(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError('Date must be a string', { value, type: typeof value });
  }

  // Validate ISO 8601 format or common date formats
  const dateRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/;
  if (!dateRegex.test(value) && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError(
      `Invalid date format: ${value}. Expected ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ)`,
      { value, expectedFormat: 'ISO 8601 (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ)' }
    );
  }

  return value;
}

/**
 * Validate mint address (Solana-specific)
 * Uses base58 decode → 32 bytes (gold standard)
 *
 * @deprecated Use validateSolanaAddress from address-validator.ts instead
 */
export function validateMintAddress(value: unknown): string {
  // Re-export from address-validator
  return validateMintAddressImpl(value);
}
