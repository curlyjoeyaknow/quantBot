/**
 * Handler for architecture test-boundaries command
 *
 * Runs the architecture boundary verification script and reports results.
 */

import type { CommandContext } from '../../core/command-context.js';
import type { ArchitectureTestBoundariesArgs } from '../../command-defs/architecture.js';
import { execa } from 'execa';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '../../../../..');

export interface BoundaryViolation {
  file: string;
  line: number;
  message: string;
}

export interface TestBoundariesResult {
  violations: BoundaryViolation[];
  totalViolations: number;
  passed: boolean;
  error?: string;
}

/**
 * Test architecture boundaries using the verification script
 */
export async function testBoundariesHandler(
  args: ArchitectureTestBoundariesArgs,
  ctx: CommandContext
): Promise<TestBoundariesResult> {
  try {
    const scriptPath = join(ROOT, 'scripts/verify-architecture-boundaries.ts');

    // Run the script and capture output
    const { stdout, stderr, exitCode } = await execa('tsx', [scriptPath], {
      cwd: ROOT,
      reject: false, // Don't throw on non-zero exit
    });

    if (exitCode !== 0) {
      // Parse violations from output
      // The script outputs violations in a structured format
      const violations: BoundaryViolation[] = [];
      const lines = stdout.split('\n');

      for (const line of lines) {
        // Look for violation patterns in the output
        // Format: "file:line: message"
        const match = line.match(/^(.+?):(\d+):\s*(.+)$/);
        if (match) {
          violations.push({
            file: match[1],
            line: parseInt(match[2], 10),
            message: match[3],
          });
        }
      }

      return {
        violations,
        totalViolations: violations.length,
        passed: false,
        error: stderr || undefined,
      };
    }

    return {
      violations: [],
      totalViolations: 0,
      passed: true,
    };
  } catch (error) {
    return {
      violations: [],
      totalViolations: 0,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
