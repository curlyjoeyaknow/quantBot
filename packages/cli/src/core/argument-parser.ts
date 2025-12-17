/**
 * Argument Parser - Zod-based validation and parsing
 */

import { z } from 'zod';
import { logger, ValidationError } from '@quantbot/utils';
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
 */
export function normalizeOptions(options: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(options)) {
    // Convert camelCase to kebab-case for consistency
    const normalizedKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();

    // Handle undefined/null values
    if (value === undefined || value === null) {
      continue;
    }

    // Handle string values that might be numbers or booleans
    if (typeof value === 'string') {
      // Try to parse as number
      if (value === 'true') {
        normalized[normalizedKey] = true;
      } else if (value === 'false') {
        normalized[normalizedKey] = false;
      } else if (!isNaN(Number(value)) && value.trim() !== '') {
        normalized[normalizedKey] = Number(value);
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
