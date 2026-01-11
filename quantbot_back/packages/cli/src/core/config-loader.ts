/**
 * Config Loader - Load YAML/JSON configuration files with CLI override merging
 *
 * Provides config-first runner pattern:
 * - Auto-detect config format (YAML/JSON) by extension
 * - Load and parse config files
 * - Deep merge CLI overrides into config
 * - Validate with Zod schema
 *
 * This pattern eliminates long CLI strings and makes experiments reproducible.
 */

import { readFileSync } from 'fs';
import { extname } from 'path';
import * as yaml from 'js-yaml';
import type { z } from 'zod';
import { ValidationError } from '@quantbot/utils';

/**
 * Detect config format by file extension
 */
export function detectConfigFormat(path: string): 'yaml' | 'json' {
  const ext = extname(path).toLowerCase();
  if (ext === '.yaml' || ext === '.yml') {
    return 'yaml';
  }
  if (ext === '.json') {
    return 'json';
  }
  // Default to JSON for unknown extensions
  return 'json';
}

/**
 * Deep merge two objects (CLI overrides win)
 *
 * Rules:
 * - Primitives: override value wins
 * - Arrays: override value replaces base value
 * - Objects: recursively merge (deep merge)
 *
 * @param base - Base config object
 * @param override - Override values from CLI
 * @returns Merged object
 */
export function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) {
      // Skip undefined values from CLI
      continue;
    }

    if (!(key in result)) {
      // Key doesn't exist in base - add it
      result[key] = value;
      continue;
    }

    const baseValue = result[key];

    // If override is not an object or base is not an object, replace
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      typeof baseValue !== 'object' ||
      baseValue === null ||
      Array.isArray(baseValue)
    ) {
      result[key] = value;
      continue;
    }

    // Both are objects (not arrays, not null) - deep merge
    result[key] = deepMerge(baseValue as Record<string, unknown>, value as Record<string, unknown>);
  }

  return result;
}

/**
 * Load config from YAML or JSON file
 *
 * Auto-detects format by file extension (.yaml/.yml vs .json).
 * Merges CLI overrides into config (deep merge).
 * Validates with Zod schema.
 *
 * @param configPath - Path to config file
 * @param schema - Zod schema for validation
 * @param overrides - CLI overrides to merge (optional)
 * @returns Validated config object
 * @throws ValidationError if config is invalid
 */
export async function loadConfig<T>(
  configPath: string,
  schema: z.ZodSchema<T>,
  overrides?: Record<string, unknown>
): Promise<T> {
  let configData: Record<string, unknown>;

  // 1. Load and parse config file
  try {
    const fileContent = readFileSync(configPath, 'utf-8');
    const format = detectConfigFormat(configPath);

    if (format === 'yaml') {
      const parsed = yaml.load(fileContent);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new ValidationError('YAML config must be an object', {
          configPath,
          format: 'yaml',
        });
      }
      configData = parsed as Record<string, unknown>;
    } else {
      const parsed = JSON.parse(fileContent);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new ValidationError('JSON config must be an object', {
          configPath,
          format: 'json',
        });
      }
      configData = parsed as Record<string, unknown>;
    }
  } catch (error) {
    throw new ValidationError(
      `Failed to load config from ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
      { configPath, error }
    );
  }

  // 2. Merge CLI overrides (if provided)
  if (overrides && Object.keys(overrides).length > 0) {
    configData = deepMerge(configData, overrides);
  }

  // 3. Validate with Zod schema
  const parsed = schema.safeParse(configData);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ValidationError(`Config validation failed: ${issues}`, {
      configPath,
      issues: parsed.error.issues,
    });
  }

  return parsed.data;
}
