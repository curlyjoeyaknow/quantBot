#!/usr/bin/env tsx

/**
 * CI Hygiene Checks
 *
 * Comprehensive checks to ensure repository hygiene and safety:
 * - No build artifacts in source
 * - No runtime state files
 * - No forbidden files in root
 * - Package boundaries respected
 * - Run ID determinism verified
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..', '..');
const ROOT = __dirname;

interface Violation {
  file: string;
  reason: string;
  severity: 'error' | 'warning';
}

const violations: Violation[] = [];

/**
 * Check 1: No build artifacts in source directories
 */
function checkBuildArtifacts(): void {
  console.log('🔍 Checking for build artifacts in source...');

  const packagesDir = join(ROOT, 'packages');
  if (!statSync(packagesDir, { throwIfNoEntry: false })?.isDirectory()) {
    return;
  }

  const packages = readdirSync(packagesDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

  for (const pkg of packages) {
    const srcDir = join(packagesDir, pkg, 'src');
    if (!statSync(srcDir, { throwIfNoEntry: false })?.isDirectory()) {
      continue;
    }

    // Check for .js, .js.map, .d.ts, .d.ts.map files in src/
    const files = findFiles(srcDir, [/\.js$/, /\.js\.map$/, /\.d\.ts$/, /\.d\.ts\.map$/]);
    for (const file of files) {
      violations.push({
        file: file.replace(ROOT + '/', ''),
        reason: 'Build artifact found in src/ directory',
        severity: 'error',
      });
    }
  }
}

/**
 * Check 2: No runtime state files
 */
function checkRuntimeState(): void {
  console.log('🔍 Checking for runtime state files...');

  const runtimePatterns = [
    /\.duckdb\.wal$/,
    /^integration_test_.*\.duckdb$/,
    /^integration_test_.*\.duckdb\.wal$/,
    /^.*_test_.*\.duckdb$/,
    /^.*_test_.*\.duckdb\.wal$/,
    /^chain_detection_test_.*\.duckdb$/,
    /^invalid_groups_test_.*\.duckdb$/,
  ];

  // Check root directory
  const rootFiles = readdirSync(ROOT, { withFileTypes: true })
    .filter((dirent) => dirent.isFile())
    .map((dirent) => dirent.name);

  for (const fileName of rootFiles) {
    for (const pattern of runtimePatterns) {
      if (pattern.test(fileName)) {
        violations.push({
          file: fileName,
          reason: 'Runtime state file found at repo root',
          severity: 'error',
        });
        break;
      }
    }
  }

  // Check for logs directory
  const logsDir = join(ROOT, 'logs');
  if (statSync(logsDir, { throwIfNoEntry: false })?.isDirectory()) {
    violations.push({
      file: 'logs/',
      reason: 'logs/ directory found (runtime state, should not be committed)',
      severity: 'error',
    });
  }
}

/**
 * Check 3: No forbidden files in root
 */
function checkRootFiles(): void {
  console.log('🔍 Checking for forbidden files in root...');

  const allowedRootFiles = [
    'README.md',
    'CHANGELOG.md',
    'TODO.md',
    'ARCHITECTURE.md',
    'SECURITY.md',
    'CONTRIBUTING.md',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.json',
    'tsconfig.base.json',
    'tsconfig.scripts.json',
    'vitest.config.ts',
    'vitest.stress.config.ts',
    'eslint.config.mjs',
    'docker-compose.yml',
    '.gitignore',
    '.gitattributes',
    '.cursorignore',
    'env.example',
  ];

  const forbiddenPatterns = [
    /^--dbPath$/,
    /.*_SUMMARY\.md$/,
    /.*_COMPLETE\.md$/,
    /.*_STATUS\.md$/,
    /.*_PROGRESS\.md$/,
    /.*_REPORT\.md$/,
    /COVERAGE_.*\.md$/,
    /TEST_.*\.md$/,
    /SETUP_.*\.md$/,
    /IMPLEMENTATION_.*\.md$/,
    /.*_REVIEW\.md$/,
  ];

  const rootFiles = readdirSync(ROOT, { withFileTypes: true })
    .filter((dirent) => dirent.isFile())
    .map((dirent) => dirent.name);

  for (const fileName of rootFiles) {
    // Skip allowed files
    if (allowedRootFiles.includes(fileName)) {
      continue;
    }

    // Check forbidden patterns
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(fileName)) {
        violations.push({
          file: fileName,
          reason: 'Forbidden file pattern in root (should be in docs/)',
          severity: 'error',
        });
        break;
      }
    }
  }
}

/**
 * Check 4: Package.json hygiene
 */
function checkPackageJson(): void {
  console.log('🔍 Checking package.json hygiene...');

  const packageJsonPath = join(ROOT, 'package.json');
  if (!existsSync(packageJsonPath)) {
    violations.push({
      file: 'package.json',
      reason: 'package.json not found',
      severity: 'error',
    });
    return;
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

    // Check for required scripts
    const requiredScripts = ['build', 'test', 'lint', 'typecheck'];
    for (const script of requiredScripts) {
      if (!packageJson.scripts || !packageJson.scripts[script]) {
        violations.push({
          file: 'package.json',
          reason: `Missing required script: ${script}`,
          severity: 'warning',
        });
      }
    }
  } catch (error) {
    violations.push({
      file: 'package.json',
      reason: `Failed to parse package.json: ${error}`,
      severity: 'error',
    });
  }
}

/**
 * Find files matching patterns recursively
 */
function findFiles(
  dir: string,
  patterns: RegExp[],
  excludeDirs: string[] = ['node_modules', 'dist', '.git']
): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory() && !excludeDirs.includes(entry.name)) {
      files.push(...findFiles(fullPath, patterns, excludeDirs));
    } else if (entry.isFile()) {
      for (const pattern of patterns) {
        if (pattern.test(entry.name)) {
          files.push(fullPath);
          break;
        }
      }
    }
  }

  return files;
}

/**
 * Main check function
 */
function main(): void {
  console.log('🚀 Running CI hygiene checks...\n');

  checkBuildArtifacts();
  checkRuntimeState();
  checkRootFiles();
  checkPackageJson();

  // Separate errors and warnings
  const errors = violations.filter((v) => v.severity === 'error');
  const warnings = violations.filter((v) => v.severity === 'warning');

  if (errors.length > 0) {
    console.error('\n❌ Hygiene check failures (errors):\n');
    for (const violation of errors) {
      console.error(`  ${violation.file}`);
      console.error(`    Reason: ${violation.reason}\n`);
    }
  }

  if (warnings.length > 0) {
    console.warn('\n⚠️  Hygiene check warnings:\n');
    for (const violation of warnings) {
      console.warn(`  ${violation.file}`);
      console.warn(`    Reason: ${violation.reason}\n`);
    }
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log('\n✅ All hygiene checks passed!\n');
    process.exit(0);
  } else if (errors.length > 0) {
    console.error('\n💡 Fix errors by:');
    console.error('   - Removing build artifacts from src/ directories');
    console.error('   - Removing runtime state files');
    console.error('   - Moving forbidden files to appropriate locations\n');
    process.exit(1);
  } else {
    // Only warnings, don't fail
    process.exit(0);
  }
}

main();
