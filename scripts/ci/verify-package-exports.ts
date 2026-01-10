#!/usr/bin/env node
/**
 * Package Exports Verification Script
 *
 * Verifies that all package.json exports are correctly configured.
 * This ensures our TypeScript configuration changes don't break package exports.
 *
 * Run: tsx scripts/ci/verify-package-exports.ts
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '../..');

function getAllPackageJsonFiles(): string[] {
  const packagesDir = join(projectRoot, 'packages');
  const packages = readdirSync(packagesDir);
  return packages
    .map((pkg) => join(packagesDir, pkg, 'package.json'))
    .filter((path) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    });
}

function parsePackageJson(path: string): {
  name: string;
  exports?: Record<string, unknown>;
  type?: string;
} {
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content);
}

let errors: string[] = [];

console.log('🔍 Verifying package exports...\n');

const packageFiles = getAllPackageJsonFiles();

// Test 1: All packages (except CLI) should have exports
for (const pkgPath of packageFiles) {
  const pkg = parsePackageJson(pkgPath);

  if (pkg.name === '@quantbot/cli') {
    // CLI doesn't need exports (it's an application)
    continue;
  }

  if (!pkg.exports) {
    errors.push(`❌ ${pkg.name} should have exports field`);
  }
}

// Test 2: Consistent export path patterns
for (const pkgPath of packageFiles) {
  const pkg = parsePackageJson(pkgPath);

  if (!pkg.exports || pkg.name === '@quantbot/cli') {
    continue;
  }

  const exports = pkg.exports as Record<string, unknown>;

  if (!exports['.']) {
    errors.push(`❌ ${pkg.name} should have main export ('.')`);
    continue;
  }

  const mainExport = exports['.'] as Record<string, string>;
  if (!mainExport.types || !mainExport.import) {
    errors.push(`❌ ${pkg.name} main export should have types and import fields`);
  }

  if (mainExport.types && !mainExport.types.match(/^\.\/dist\//)) {
    errors.push(`❌ ${pkg.name} types should point to dist/: ${mainExport.types}`);
  }

  if (mainExport.import && !mainExport.import.match(/^\.\/dist\//)) {
    errors.push(`❌ ${pkg.name} import should point to dist/: ${mainExport.import}`);
  }
}

// Test 3: No src/ in export paths (except storage adapters for backward compat)
for (const pkgPath of packageFiles) {
  const pkg = parsePackageJson(pkgPath);

  if (!pkg.exports || pkg.name === '@quantbot/cli') {
    continue;
  }

  const exports = pkg.exports as Record<string, unknown>;

  for (const [key] of Object.entries(exports)) {
    if (pkg.name === '@quantbot/storage') {
      // Storage ports and adapters should NOT have src/
      if (key.startsWith('./ports/') || key.startsWith('./adapters/')) {
        if (key.includes('/src/')) {
          errors.push(`❌ ${pkg.name} export path "${key}" should not contain src/`);
        }
      }
    } else {
      // All other packages should not have src/ in export paths
      if (key.includes('/src/')) {
        errors.push(`❌ ${pkg.name} export path "${key}" should not contain src/`);
      }
    }
  }
}

// Test 4: All packages should have type: module
for (const pkgPath of packageFiles) {
  const pkg = parsePackageJson(pkgPath);
  if (pkg.type !== 'module') {
    errors.push(`❌ ${pkg.name} should have type: module`);
  }
}

// Test 5: TypeScript config inheritance
const packagesDir = join(projectRoot, 'packages');
const packages = readdirSync(packagesDir);

for (const pkgName of packages) {
  const tsconfigPath = join(packagesDir, pkgName, 'tsconfig.json');
  try {
    if (statSync(tsconfigPath).isFile()) {
      const content = readFileSync(tsconfigPath, 'utf-8');
      const tsconfig = JSON.parse(content);

      if (tsconfig.extends !== '../../tsconfig.base.json') {
        errors.push(
          `❌ ${pkgName} tsconfig should extend tsconfig.base.json (found: ${tsconfig.extends})`
        );
      }
    }
  } catch {
    // Some packages might not have tsconfig.json
  }
}

// Report results
if (errors.length > 0) {
  console.error('❌ Package exports verification failed:\n');
  errors.forEach((error) => console.error(`  ${error}`));
  process.exit(1);
} else {
  console.log('✅ All package exports are correctly configured!\n');
  console.log(`   Verified ${packageFiles.length} packages`);
  process.exit(0);
}
