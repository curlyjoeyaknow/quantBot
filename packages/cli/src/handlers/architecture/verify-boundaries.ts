/**
 * Handler for architecture verify-boundaries command
 *
 * Runs ESLint with boundary rules and reports violations.
 */

import type { CommandContext } from '../../core/command-context.js';
import type { ArchitectureVerifyBoundariesArgs } from '../../command-defs/architecture.js';
import { ESLint } from 'eslint';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '../../../../..');

export interface Violation {
  file: string;
  line: number;
  column: number;
  message: string;
  ruleId: string | null;
}

export interface VerifyBoundariesResult {
  violations: Violation[];
  totalViolations: number;
  passed: boolean;
}

/**
 * Verify architecture boundaries using ESLint
 */
export async function verifyBoundariesHandler(
  args: ArchitectureVerifyBoundariesArgs,
  ctx: CommandContext
): Promise<VerifyBoundariesResult> {
  const eslint = new ESLint({
    cwd: ROOT,
    overrideConfigFile: join(ROOT, 'eslint.config.mjs'),
  });

  // Lint all TypeScript files
  const results = await eslint.lintFiles([
    'packages/**/*.ts',
    '!packages/**/*.test.ts',
    '!packages/**/*.spec.ts',
    '!node_modules/**',
    '!dist/**',
  ]);

  const violations: Violation[] = [];

  for (const result of results) {
    for (const message of result.messages) {
      if (message.severity === 2) {
        // Error severity
        violations.push({
          file: result.filePath.replace(ROOT + '/', ''),
          line: message.line || 0,
          column: message.column || 0,
          message: message.message,
          ruleId: message.ruleId,
        });
      }
    }
  }

  return {
    violations,
    totalViolations: violations.length,
    passed: violations.length === 0,
  };
}
