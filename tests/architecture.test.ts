/**
 * Architecture tests - enforce layer boundaries at test time
 * 
 * These tests complement ESLint rules by validating architectural invariants.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

describe('Architecture Boundaries', () => {
  const packagesDir = join(__dirname, '../packages');

  function getAllTsFiles(dir: string): string[] {
    const files: string[] = [];
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage') {
          continue;
        }
        files.push(...getAllTsFiles(fullPath));
      } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.spec.ts')) {
        files.push(fullPath);
      }
    }

    return files;
  }

  function getImports(filePath: string): string[] {
    const content = readFileSync(filePath, 'utf-8');
    const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
    const imports: string[] = [];
    let match;

    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    return imports;
  }

  it('domain layer should not import from adapters or apps', () => {
    const domainFiles = getAllTsFiles(join(packagesDir, 'core/src/domain'));
    const violations: string[] = [];

    for (const file of domainFiles) {
      const imports = getImports(file);
      const forbiddenImports = imports.filter(imp =>
        imp.includes('/adapters/') || imp.includes('/apps/') || imp.includes('@quantbot/storage') || imp.includes('@quantbot/api-clients')
      );

      if (forbiddenImports.length > 0) {
        violations.push(`${file}: ${forbiddenImports.join(', ')}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('handlers should only import from domain and ports', () => {
    const handlerFiles = getAllTsFiles(join(packagesDir, 'core/src/handlers'));
    const violations: string[] = [];

    for (const file of handlerFiles) {
      const imports = getImports(file);
      const forbiddenImports = imports.filter(imp => {
        // Allow imports from domain, ports, and core utilities
        if (imp.startsWith('../domain') || imp.startsWith('../ports') || imp.startsWith('../')) {
          return false;
        }
        // Allow imports from @quantbot/core
        if (imp.startsWith('@quantbot/core')) {
          return false;
        }
        // Forbid imports from storage, api-clients, workflows, etc.
        if (imp.startsWith('@quantbot/storage') ||
            imp.startsWith('@quantbot/api-clients') ||
            imp.startsWith('@quantbot/workflows') ||
            imp.startsWith('@quantbot/ingestion') ||
            imp.startsWith('@quantbot/jobs')) {
          return true;
        }
        return false;
      });

      if (forbiddenImports.length > 0) {
        violations.push(`${file}: ${forbiddenImports.join(', ')}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('simulation layer should not use Date.now() or Math.random()', () => {
    const simulationFiles = getAllTsFiles(join(packagesDir, 'simulation/src'));
    const violations: string[] = [];

    for (const file of simulationFiles) {
      const content = readFileSync(file, 'utf-8');
      
      if (content.includes('Date.now()')) {
        violations.push(`${file}: uses Date.now()`);
      }
      
      if (content.includes('Math.random()')) {
        violations.push(`${file}: uses Math.random()`);
      }
      
      // Check for new Date() without arguments (non-deterministic)
      if (/new\s+Date\s*\(\s*\)/.test(content)) {
        violations.push(`${file}: uses new Date() without arguments`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('backtest layer should not import storage or api-clients', () => {
    const backtestFiles = getAllTsFiles(join(packagesDir, 'backtest/src'));
    const violations: string[] = [];

    for (const file of backtestFiles) {
      const imports = getImports(file);
      const forbiddenImports = imports.filter(imp =>
        imp.startsWith('@quantbot/storage') ||
        imp.startsWith('@quantbot/api-clients') ||
        imp.startsWith('@quantbot/ingestion') ||
        imp.startsWith('@quantbot/jobs')
      );

      if (forbiddenImports.length > 0) {
        violations.push(`${file}: ${forbiddenImports.join(', ')}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('no package should import from another package internals', () => {
    const allFiles = getAllTsFiles(packagesDir);
    const violations: string[] = [];

    for (const file of allFiles) {
      const imports = getImports(file);
      const internalImports = imports.filter(imp =>
        /^@quantbot\/[^/]+\/(src|dist|build|lib)\//.test(imp)
      );

      if (internalImports.length > 0) {
        violations.push(`${file}: ${internalImports.join(', ')}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('CLI handlers should not use console.log or process.exit', () => {
    const cliHandlerFiles = getAllTsFiles(join(packagesDir, 'cli/src/handlers'));
    const violations: string[] = [];

    for (const file of cliHandlerFiles) {
      const content = readFileSync(file, 'utf-8');
      
      if (content.includes('console.log') || content.includes('console.error') || content.includes('console.warn')) {
        violations.push(`${file}: uses console methods`);
      }
      
      if (content.includes('process.exit')) {
        violations.push(`${file}: uses process.exit()`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('no live trading libraries should be imported', () => {
    const allFiles = getAllTsFiles(packagesDir);
    const violations: string[] = [];

    const forbiddenLibraries = [
      '@solana/spl-token',
      '@jito-foundation/block-engine-client',
      '@solana/wallet-adapter',
      '@solana/wallet-adapter-base',
      '@solana/wallet-adapter-wallets',
    ];

    for (const file of allFiles) {
      const imports = getImports(file);
      const liveTradingImports = imports.filter(imp =>
        forbiddenLibraries.some(lib => imp.startsWith(lib))
      );

      if (liveTradingImports.length > 0) {
        violations.push(`${file}: ${liveTradingImports.join(', ')}`);
      }
    }

    expect(violations).toEqual([]);
  });
});

describe('Determinism Guarantees', () => {
  const packagesDir = join(__dirname, '../packages');

  function getAllTsFiles(dir: string): string[] {
    const files: string[] = [];
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage') {
          continue;
        }
        files.push(...getAllTsFiles(fullPath));
      } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.spec.ts')) {
        files.push(fullPath);
      }
    }

    return files;
  }

  it('handlers should not use Date.now(), new Date(), or Math.random()', () => {
    const handlerFiles = getAllTsFiles(join(packagesDir, 'core/src/handlers'));
    const violations: string[] = [];

    for (const file of handlerFiles) {
      const content = readFileSync(file, 'utf-8');
      
      if (content.includes('Date.now()')) {
        violations.push(`${file}: uses Date.now()`);
      }
      
      if (content.includes('Math.random()')) {
        violations.push(`${file}: uses Math.random()`);
      }
      
      if (/new\s+Date\s*\(\s*\)/.test(content)) {
        violations.push(`${file}: uses new Date() without arguments`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('workflow handlers should not use Date.now(), new Date(), or Math.random()', () => {
    const workflowFiles = getAllTsFiles(join(packagesDir, 'workflows/src'));
    const violations: string[] = [];

    // Exclude adapters and context (composition roots)
    const handlerFiles = workflowFiles.filter(f =>
      !f.includes('/adapters/') &&
      !f.includes('/context/') &&
      !f.includes('/infra/')
    );

    for (const file of handlerFiles) {
      const content = readFileSync(file, 'utf-8');
      
      if (content.includes('Date.now()')) {
        violations.push(`${file}: uses Date.now()`);
      }
      
      if (content.includes('Math.random()')) {
        violations.push(`${file}: uses Math.random()`);
      }
      
      if (/new\s+Date\s*\(\s*\)/.test(content)) {
        violations.push(`${file}: uses new Date() without arguments`);
      }
    }

    expect(violations).toEqual([]);
  });
});

