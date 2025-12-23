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
 * Convert camelCase to kebab-case
 * Preserves keys that already contain special characters (dashes, underscores, dots)
 */
function camelToKebab(key: string): string {
  // If key already contains dashes, underscores, or dots, preserve as-is
  if (key.includes('-') || key.includes('_') || key.includes('.')) {
    return key;
  }
  // Convert camelCase to kebab-case
  return key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Normalize Commander.js options to a flat object
 * Handles both --flag value and --flag=value formats
 *
 * Key normalization:
 * - DO NOT rename keys - Commander.js already converts --output-db to outputDb
 * - Preserve keys exactly as Commander.js provides them (camelCase)
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
    const normalizedKey = key;

    // Recursively normalize nested objects
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      normalized[normalizedKey] = normalizeOptions(value as Record<string, unknown>);
      continue;
    }

    // Handle string values that might be numbers or booleans
    if (typeof value === 'string') {
      // Try to parse as boolean
      if (value === 'true') {
        normalized[normalizedKey] = true;
      } else if (value === 'false') {
        normalized[normalizedKey] = false;
      } else if (!isNaN(Number(value)) && value.trim() !== '') {
        // Try to parse as number (but preserve if it's a file path, ID, or other non-numeric string)
        // Only convert if it's a pure number string AND not an ID-like value (long numeric strings)
        // IDs (chatId, messageId, etc.) should remain strings even if they're numeric
        const numValue = Number(value);
        const trimmed = value.trim();
        // Don't convert if:
        // - It's a file path (contains / or \)
        // - It's a long numeric string (likely an ID like chatId, messageId)
        // - It doesn't match the number exactly (has leading zeros, etc.)
        if (
          String(numValue) === trimmed &&
          !trimmed.includes('/') &&
          !trimmed.includes('\\') &&
          trimmed.length < 10
        ) {
          // Only convert short numbers (not IDs)
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
