/**
 * Dependency Boundary Enforcement Tests
 * =====================================
 *
 * Tripwire tests to ensure @quantbot/ohlcv maintains offline-only boundaries.
 *
 * These tests will fail if forbidden dependencies are added, preventing
 * accidental network creep into the offline package.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Recursively find all .ts files in a directory
 */
function findTsFiles(dir: string, baseDir: string = dir): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...findTsFiles(fullPath, baseDir));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(fullPath.replace(baseDir + '/', ''));
    }
  }

  return files;
}

describe('Dependency Boundaries - @quantbot/ohlcv', () => {
  const packageJsonPath = join(process.cwd(), 'package.json');
  let packageJson: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  try {
    packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  } catch (error) {
    throw new Error(
      `Failed to read package.json: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  it('should not depend on @quantbot/api-clients', () => {
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    expect(deps).not.toHaveProperty('@quantbot/api-clients');
  });

  it('should not depend on axios', () => {
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    expect(deps).not.toHaveProperty('axios');
  });

  it('should not depend on dotenv', () => {
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    expect(deps).not.toHaveProperty('dotenv');
  });

  it('should not import network modules in source files', () => {
    const srcDir = join(process.cwd(), 'src');
    const srcFiles = findTsFiles(srcDir, srcDir);

    // Exclude deprecated files that are not exported
    const excludedFiles = ['candles.ts', 'historical-candles.ts'];
    const activeFiles = srcFiles.filter(
      (file) => !excludedFiles.some((excluded) => file.includes(excluded))
    );

    const forbiddenPatterns = [
      /from ['"]@quantbot\/api-clients/,
      /from ['"]axios/,
      /from ['"]dotenv/,
      /from ['"]node:http/,
      /from ['"]node:https/,
      /require\(['"]@quantbot\/api-clients/,
      /require\(['"]axios/,
      /require\(['"]dotenv/,
      /require\(['"]node:http/,
      /require\(['"]node:https/,
    ];

    const violations: Array<{ file: string; pattern: string }> = [];

    for (const file of activeFiles) {
      const fullPath = join(srcDir, file);
      const content = readFileSync(fullPath, 'utf-8');
      for (const pattern of forbiddenPatterns) {
        if (pattern.test(content)) {
          violations.push({ file, pattern: pattern.toString() });
        }
      }
    }

    if (violations.length > 0) {
      const violationMessages = violations.map((v) => `  ${v.file}: ${v.pattern}`).join('\n');
      throw new Error(
        `Found forbidden network imports in source files:\n${violationMessages}\n\n` +
          `@quantbot/ohlcv must remain offline-only. Use @quantbot/jobs for network operations.`
      );
    }
  });
});
