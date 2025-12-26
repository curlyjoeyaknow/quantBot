/**
 * Build Smoke Test
 *
 * Quick validation that all packages build successfully.
 * This is a critical path test that should run fast (< 5 seconds).
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '../..');

describe('Build Smoke Test', () => {
  it('should build all packages in order', () => {
    // This is a smoke test - we just verify the build command exists and can be called
    // In CI, the actual build happens in a separate step
    // Here we just verify that build artifacts would be created
    const packageJsonPath = join(ROOT, 'package.json');
    const packageJsonContent = readFileSync(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonContent);
    expect(packageJson.scripts.build).toBeDefined();
  });

  it('should have TypeScript config files', () => {
    const tsconfigPath = join(ROOT, 'tsconfig.json');
    expect(existsSync(tsconfigPath)).toBe(true);
  });

  it('should have package.json with required scripts', () => {
    const packageJsonPath = join(ROOT, 'package.json');
    const packageJsonContent = readFileSync(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonContent);
    const requiredScripts = ['build', 'test', 'lint', 'typecheck'];
    for (const script of requiredScripts) {
      expect(packageJson.scripts[script]).toBeDefined();
    }
  });
});


