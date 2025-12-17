/**
 * Handler for DuckDB-based statistical analysis.
 * Calls Python analysis script and returns results.
 */

import type { CommandContext } from '../../core/command-context.js';
import { execa } from 'execa';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger, AppError, ValidationError, TimeoutError } from '@quantbot/utils';
import { analyzeDuckdbSchema, type AnalyzeDuckdbArgs } from '../../command-defs/analytics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Re-export schema for convenience
export { analyzeDuckdbSchema };
export type { AnalyzeDuckdbArgs };

export async function analyzeDuckdbHandler(args: AnalyzeDuckdbArgs, ctx: CommandContext) {
  const pythonScript = path.resolve(__dirname, '../../../../../tools/telegram/cli/analyze.py');

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
    throw new ValidationError('Must specify --caller, --mint, or --correlation', {
      operation: 'analyze_duckdb',
      provided: {
        caller: !!args.caller,
        mint: !!args.mint,
        correlation: !!args.correlation,
      },
    });
  }

  try {
    const { stdout, stderr } = await execa('python3', [pythonScript, ...pythonArgs], {
      encoding: 'utf8',
      timeout: 60000, // 1 minute timeout
    });

    if (stderr) {
      logger.warn('Python analysis stderr', { stderr });
    }

    // Parse JSON output
    const result = JSON.parse(stdout);
    return result;
  } catch (error) {
    logger.error('Analysis failed', error);

    // Handle timeout errors
    if (
      error instanceof Error &&
      (error.message.includes('timeout') || error.message.includes('killed'))
    ) {
      throw new TimeoutError('Analysis timed out after 1 minute', 60000, {
        script: pythonScript,
        args: pythonArgs,
      });
    }

    // Re-throw AppErrors as-is
    if (error instanceof AppError) {
      throw error;
    }

    // Wrap other errors
    throw new AppError(
      `Analysis failed: ${error instanceof Error ? error.message : String(error)}`,
      'ANALYSIS_FAILED',
      500,
      { script: pythonScript, args: pythonArgs }
    );
  }
}
