/**
 * Quality Gates Smoke Test
 *
 * Quick validation that critical quality gate checks work.
 * This ensures the quality gate infrastructure is functional.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..', '..');
const ROOT = __dirname;

describe('Quality Gates Smoke Test', () => {
  it('should have verification scripts', () => {
    const scripts = [
      'scripts/ci/verify-handler-tests.ts',
      'scripts/ci/verify-property-tests.ts',
      'scripts/ci/verify-changelog.ts',
      'scripts/ci/verify-documentation.ts',
      'scripts/ci/check-coverage-decrease.ts',
    ];

    for (const script of scripts) {
      const scriptPath = join(ROOT, script);
      expect(existsSync(scriptPath)).toBe(true);
    }
  });

  it('should have ESLint config', () => {
    const eslintPath = join(ROOT, 'eslint.config.mjs');
    expect(existsSync(eslintPath)).toBe(true);
  });

  it('should have vitest config', () => {
    const vitestPath = join(ROOT, 'vitest.config.ts');
    expect(existsSync(vitestPath)).toBe(true);
  });

  it('should have CHANGELOG.md', () => {
    const changelogPath = join(ROOT, 'CHANGELOG.md');
    expect(existsSync(changelogPath)).toBe(true);
  });

  it('should have package.json with quality gate scripts', () => {
    const packageJson = require(join(ROOT, 'package.json'));
    const requiredScripts = [
      'verify:handler-tests',
      'verify:property-tests',
      'verify:changelog',
      'verify:documentation',
      'check:coverage-decrease',
      'test:smoke',
    ];

    for (const script of requiredScripts) {
      expect(packageJson.scripts[script]).toBeDefined();
    }
  });
});


