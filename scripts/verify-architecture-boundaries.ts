#!/usr/bin/env node

/**
 * Architecture Boundary Enforcement Tests
 *
 * These are structural tests that catch architectural drift early.
 * They verify:
 * 1. Forbidden imports test - handlers don't import from outside @quantbot/core
 * 2. Public API enforcement - no deep imports from @quantbot packages
 * 3. Layer boundary enforcement - research lab layers respect boundaries
 *
 * Run this as part of CI/CD to catch violations before merge.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');

const ROOT = join(__dirname, '..');
const PACKAGES_DIR = join(ROOT, 'packages');

interface Violation {
  file: string;
  line: number;
  message: string;
}

const violations: Violation[] = [];

/**
 * Test 1: Forbidden imports in handlers
 *
 * Handlers in packages/core/src/handlers/** should only import from:
 * - @quantbot/core (public API)
 * - Relative imports within the same package
 * - Standard library modules
 *
 * They should NOT import from:
 * - Other @quantbot packages (except @quantbot/core)
 * - Node built-ins that do I/O (fs, path, os, etc.) - already enforced by ESLint
 */
function testForbiddenImportsInHandlers(): void {
  const handlersDir = join(PACKAGES_DIR, 'core', 'src', 'handlers');
  if (!statSync(handlersDir, { throwIfNoEntry: false })?.isDirectory()) {
    console.log('⚠️  No handlers directory found, skipping handler import test');
    return;
  }

  const handlerFiles = findTsFiles(handlersDir);
  console.log(`\n📋 Testing ${handlerFiles.length} handler files for forbidden imports...`);

  for (const file of handlerFiles) {
    const content = readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      const lineNum = index + 1;

      // Check for imports from other @quantbot packages (except @quantbot/core)
      const otherPackageImport = /from\s+['"]@quantbot\/(?!core)([^'"]+)['"]/;
      const match = line.match(otherPackageImport);
      if (match) {
        violations.push({
          file: file.replace(ROOT + '/', ''),
          line: lineNum,
          message: `Handler imports from @quantbot/${match[1]}. Handlers should only import from @quantbot/core (public API).`,
        });
      }

      // Check for deep imports from @quantbot/core/src
      const deepCoreImport = /from\s+['"]@quantbot\/core\/src\//;
      if (deepCoreImport.test(line)) {
        violations.push({
          file: file.replace(ROOT + '/', ''),
          line: lineNum,
          message: `Handler uses deep import from @quantbot/core/src. Use @quantbot/core (public API) instead.`,
        });
      }
    });
  }
}

/**
 * Test 2: Public API enforcement
 *
 * No code should import from @quantbot/*\/src/** anymore.
 * Only @quantbot/<pkg> (public API) should be used.
 */
function testPublicApiEnforcement(): void {
  console.log('\n📋 Testing all packages for deep imports (public API enforcement)...');

  const packages = readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

  for (const pkg of packages) {
    const srcDir = join(PACKAGES_DIR, pkg, 'src');
    if (!statSync(srcDir, { throwIfNoEntry: false })?.isDirectory()) {
      continue;
    }

    const files = findTsFiles(srcDir);
    for (const file of files) {
      // Skip test files for this check (they may need deep imports for testing)
      if (file.includes('.test.') || file.includes('.spec.')) {
        continue;
      }

      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        const lineNum = index + 1;

        // Check for deep imports from any @quantbot package
        const deepImport = /from\s+['"]@quantbot\/([^'"]+)\/src\//;
        const match = line.match(deepImport);
        if (match) {
          const packageName = match[1];
          violations.push({
            file: file.replace(ROOT + '/', ''),
            line: lineNum,
            message: `Deep import from @quantbot/${packageName}/src/. Use @quantbot/${packageName} (public API) instead.`,
          });
        }
      });
    }
  }
}

/**
 * Test 3: Layer boundary enforcement
 *
 * Enforces research lab layer boundaries:
 * - Simulation cannot import from ingestion/api-clients/ohlcv
 * - Ingestion cannot import from simulation
 * - Analytics cannot import from ingestion (feature engineering should use canonical data)
 */
function testLayerBoundaries(): void {
  console.log('\n📋 Testing layer boundaries (research lab architecture)...');

  // Layer 1: Ingestion packages
  const ingestionPackages = ['ingestion', 'api-clients', 'jobs'];

  // Layer 2: Feature engineering packages
  const featurePackages = ['analytics', 'ohlcv'];

  // Layer 3: Strategy packages
  const strategyPackages = ['simulation'];

  // Check: Simulation cannot import from ingestion layer
  for (const pkg of strategyPackages) {
    const srcDir = join(PACKAGES_DIR, pkg, 'src');
    if (!statSync(srcDir, { throwIfNoEntry: false })?.isDirectory()) {
      continue;
    }

    const files = findTsFiles(srcDir);
    for (const file of files) {
      if (file.includes('.test.') || file.includes('.spec.')) {
        continue;
      }

      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        const lineNum = index + 1;

        // Check for imports from ingestion layer
        for (const ingestionPkg of ingestionPackages) {
          const importPattern = new RegExp(`from\\s+['"]@quantbot/${ingestionPkg}(?:/.*)?['"]`);
          if (importPattern.test(line)) {
            violations.push({
              file: file.replace(ROOT + '/', ''),
              line: lineNum,
              message: `Layer violation: @quantbot/${pkg} (Strategy layer) imports from @quantbot/${ingestionPkg} (Ingestion layer). Strategy layer must not depend on ingestion layer.`,
            });
          }
        }

        // Check for imports from feature layer (simulation should use canonical data, not direct feature imports)
        // Note: This is stricter - simulation can use ohlcv for candles, but should not import analytics
        for (const featurePkg of featurePackages) {
          if (featurePkg === 'analytics') {
            const importPattern = new RegExp(`from\\s+['"]@quantbot/${featurePkg}(?:/.*)?['"]`);
            if (importPattern.test(line)) {
              violations.push({
                file: file.replace(ROOT + '/', ''),
                line: lineNum,
                message: `Layer violation: @quantbot/${pkg} (Strategy layer) imports from @quantbot/${featurePkg} (Feature layer). Strategy should work with canonical data, not feature engineering.`,
              });
            }
          }
        }
      });
    }
  }

  // Check: Ingestion cannot import from strategy layer
  for (const pkg of ingestionPackages) {
    const srcDir = join(PACKAGES_DIR, pkg, 'src');
    if (!statSync(srcDir, { throwIfNoEntry: false })?.isDirectory()) {
      continue;
    }

    const files = findTsFiles(srcDir);
    for (const file of files) {
      if (file.includes('.test.') || file.includes('.spec.')) {
        continue;
      }

      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        const lineNum = index + 1;

        for (const strategyPkg of strategyPackages) {
          const importPattern = new RegExp(`from\\s+['"]@quantbot/${strategyPkg}(?:/.*)?['"]`);
          if (importPattern.test(line)) {
            violations.push({
              file: file.replace(ROOT + '/', ''),
              line: lineNum,
              message: `Layer violation: @quantbot/${pkg} (Ingestion layer) imports from @quantbot/${strategyPkg} (Strategy layer). Ingestion layer must not depend on strategy layer.`,
            });
          }
        }
      });
    }
  }
}

/**
 * Find all TypeScript files recursively
 */
function findTsFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip node_modules, dist, and test directories
      if (
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === 'tests' ||
        entry.name === 'test'
      ) {
        continue;
      }
      files.push(...findTsFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Main test runner
 */
function main(): void {
  console.log('🏗️  Architecture Boundary Enforcement Tests\n');
  console.log('='.repeat(60));

  testForbiddenImportsInHandlers();
  testPublicApiEnforcement();
  testLayerBoundaries();

  console.log('\n' + '='.repeat(60));

  if (violations.length === 0) {
    console.log('✅ All architecture boundary tests passed!');
    process.exit(0);
  } else {
    console.log(`\n❌ Found ${violations.length} architecture boundary violation(s):\n`);

    violations.forEach((violation, index) => {
      console.log(`${index + 1}. ${violation.file}:${violation.line}`);
      console.log(`   ${violation.message}\n`);
    });

    console.log('\n💡 Fix these violations by:');
    console.log('   - Using public API imports (@quantbot/<pkg>) instead of deep imports');
    console.log('   - Ensuring handlers only import from @quantbot/core');
    console.log('   - Moving shared code to appropriate packages if needed\n');

    process.exit(1);
  }
}

main();
