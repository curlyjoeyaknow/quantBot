/**
 * Handler for DuckDB-based statistical analysis.
 * Calls Python analysis script and returns results.
 */

import type { CommandContext } from '../../core/command-context.js';
import { execa } from 'execa';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '@quantbot/utils';
import { analyzeDuckdbSchema, type AnalyzeDuckdbArgs } from '../../command-defs/analytics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Re-export schema for convenience
export { analyzeDuckdbSchema };
export type { AnalyzeDuckdbArgs };

export async function analyzeDuckdbHandler(args: AnalyzeDuckdbArgs, ctx: CommandContext) {
  const pythonScript = path.resolve(
    __dirname,
    '../../../../../tools/telegram/cli/analyze.py'
  );

  const pythonArgs = ['--duckdb', args.duckdb];

  if (args.caller) {
    pythonArgs.push('--caller', args.caller);
  } else if (args.mint) {
    pythonArgs.push('--mint', args.mint);
  } else if (args.correlation) {
    pythonArgs.push('--correlation');
    // Note: The Python script would need to be updated to accept correlation config
    // For now, this is a placeholder
    logger.warn('Correlation analysis configuration not yet implemented in Python script');
  } else {
    throw new Error('Must specify --caller, --mint, or --correlation');
  }

  try {
    const { stdout, stderr } = await execa('python3', [pythonScript, ...pythonArgs], {
      encoding: 'utf8',
      timeout: 60000, // 1 minute timeout
    });

    if (stderr) {
      logger.warn('Python analysis stderr:', stderr);
    }

    // Parse JSON output
    const result = JSON.parse(stdout);
    return result;
  } catch (error) {
    logger.error('Analysis failed:', error);
    throw new Error(`Analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
