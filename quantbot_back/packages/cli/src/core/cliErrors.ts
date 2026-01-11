/**
 * CLI Error Formatting
 *
 * Provides consistent, user-friendly error messages for CLI commands.
 */

/**
 * Format and print error, then exit with code 1
 */
export function die(e: unknown): never {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e);

  // Keep it simple and readable
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}
