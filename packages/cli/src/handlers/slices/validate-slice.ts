/**
 * Validate Slice Handler
 *
 * Pure handler that validates a slice manifest.
 */

import type { CommandContext } from '../../core/command-context.js';
import { createSliceValidatorAdapter } from '@quantbot/storage';
import { promises as fs } from 'fs';
import type { z } from 'zod';
import { validateSliceSchema } from '../../commands/slices.js';
import type { SliceManifestV1 } from '@quantbot/workflows';

export type ValidateSliceArgs = z.infer<typeof validateSliceSchema>;

/**
 * Validate slice handler
 */
export async function validateSliceHandler(
  args: ValidateSliceArgs,
  ctx: CommandContext
): Promise<unknown> {
  await ctx.ensureInitialized();

  // Read manifest from file
  const manifestContent = await fs.readFile(args.manifest, 'utf-8');
  const manifest = JSON.parse(manifestContent) as SliceManifestV1;

  // Create validator
  const validator = createSliceValidatorAdapter();

  // Validate
  const result = await validator.validate(manifest);

  return {
    ok: result.ok,
    errors: result.errors,
    warnings: result.warnings,
    manifestId: manifest.manifestId,
  };
}

