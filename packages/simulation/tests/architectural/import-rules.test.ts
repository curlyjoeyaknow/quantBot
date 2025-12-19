/**
 * Architectural Enforcement Tests
 * ================================
 *
 * Verifies that simulation package does not import forbidden dependencies.
 *
 * This is a runtime check that complements ESLint import firewall.
 *
 * Forbidden imports:
 * - @quantbot/storage
 * - @quantbot/api-clients
 * - @quantbot/ohlcv
 * - @quantbot/ingestion
 * - axios (network calls)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FORBIDDEN_IMPORTS = [
  '@quantbot/storage',
  '@quantbot/api-clients',
  '@quantbot/ohlcv',
  '@quantbot/ingestion',
  'axios',
];

function getAllTsFiles(dir: string, baseDir: string = dir): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Skip test directories
      if (entry === 'tests' || entry === 'test' || entry === '__tests__') {
        continue;
      }
      files.push(...getAllTsFiles(fullPath, baseDir));
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.spec.ts')
    ) {
      files.push(fullPath.replace(baseDir + '/', ''));
    }
  }

  return files;
}

describe('Architectural Enforcement - Import Rules', () => {
  it('should not import forbidden packages in simulation source', () => {
    // Get path relative to test file location
    const simulationSrcDir = join(__dirname, '../../src');
    const files = getAllTsFiles(simulationSrcDir, simulationSrcDir);

    const violations: Array<{ file: string; import: string }> = [];

    for (const file of files) {
      const filePath = join(simulationSrcDir, file);
      const content = readFileSync(filePath, 'utf-8');

      // Remove comments and strings to avoid false positives
      // Simple approach: remove single-line comments and multi-line comments
      let codeOnly = content;
      
      // Remove multi-line comments /* ... */
      codeOnly = codeOnly.replace(/\/\*[\s\S]*?\*\//g, '');
      
      // Remove single-line comments // ...
      codeOnly = codeOnly.replace(/\/\/.*$/gm, '');

      // Check for forbidden imports in code (not in comments)
      for (const forbidden of FORBIDDEN_IMPORTS) {
        // Match import statements: import ... from 'package' or require('package')
        const importRegex = new RegExp(
          `(?:import|from|require)\\s+['"]${forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`,
          'g'
        );

        if (importRegex.test(codeOnly)) {
          violations.push({ file, import: forbidden });
        }
      }
    }

    if (violations.length > 0) {
      console.error('\n❌ Architectural violations found:\n');
      violations.forEach((v) => {
        console.error(`  ${v.file}: imports ${v.import}`);
      });
    }

    expect(violations).toEqual([]);
  });

  it('should not have network-related imports', () => {
    // Get path relative to test file location
    const simulationSrcDir = join(__dirname, '../../src');
    const files = getAllTsFiles(simulationSrcDir, simulationSrcDir);

    const violations: Array<{ file: string; import: string }> = [];

    for (const file of files) {
      const filePath = join(simulationSrcDir, file);
      const content = readFileSync(filePath, 'utf-8');

      // Check for axios, fetch, http, https
      const networkImports = ['axios', 'node-fetch', 'got', 'http', 'https'];
      for (const networkImport of networkImports) {
        const importRegex = new RegExp(`(?:import|from|require)\\s+['"]${networkImport}['"]`, 'g');

        if (importRegex.test(content)) {
          violations.push({ file, import: networkImport });
        }
      }
    }

    if (violations.length > 0) {
      console.error('\n❌ Network imports found in simulation:\n');
      violations.forEach((v) => {
        console.error(`  ${v.file}: imports ${v.import}`);
      });
    }

    expect(violations).toEqual([]);
  });
});
