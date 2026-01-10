#!/usr/bin/env tsx

/**
 * CI Check: No Build Artifacts in Source
 *
 * This script fails the build if any generated files appear in src/ directories.
 * This prevents "works on my machine" issues and ensures clean builds.
 *
 * Checks for:
 * - *.js.map files in src/
 * - *.d.ts.map files in src/
 * - *.d.ts files in src/ (should only be in dist/)
 * - *.duckdb.wal files anywhere
 * - logs/ directory
 * - Runtime junk files
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..', '..');
const ROOT = __dirname;

interface Violation {
  file: string;
  reason: string;
}

const violations: Violation[] = [];

/**
 * Recursively find all files matching patterns
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

    // Skip excluded directories
    if (entry.isDirectory() && !excludeDirs.includes(entry.name)) {
      files.push(...findFiles(fullPath, patterns, excludeDirs));
    } else if (entry.isFile()) {
      // Check if file matches any pattern
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
 * Check for build artifacts in src/ directories
 */
function checkBuildArtifactsInSrc(): void {
  console.log('🔍 Checking for build artifacts in src/ directories...');

  const packagesDir = join(ROOT, 'packages');
  if (!statSync(packagesDir, { throwIfNoEntry: false })?.isDirectory()) {
    console.log('⚠️  No packages directory found, skipping check');
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

    // Check for .js.map files
    const jsMapFiles = findFiles(srcDir, [/\.js\.map$/]);
    for (const file of jsMapFiles) {
      violations.push({
        file: file.replace(ROOT + '/', ''),
        reason: 'Build artifact (.js.map) found in src/ directory',
      });
    }

    // Check for .d.ts.map files
    const dtsMapFiles = findFiles(srcDir, [/\.d\.ts\.map$/]);
    for (const file of dtsMapFiles) {
      violations.push({
        file: file.replace(ROOT + '/', ''),
        reason: 'Build artifact (.d.ts.map) found in src/ directory',
      });
    }

    // Check for .d.ts files (should only be in dist/)
    const dtsFiles = findFiles(srcDir, [/\.d\.ts$/]);
    for (const file of dtsFiles) {
      // Allow .d.ts files that are explicitly part of the source (rare, but possible)
      // But flag them for review
      violations.push({
        file: file.replace(ROOT + '/', ''),
        reason: 'Declaration file (.d.ts) found in src/ - should be in dist/',
      });
    }
  }
}

/**
 * Check for DuckDB WAL files
 */
function checkDuckdbWalFiles(): void {
  console.log('🔍 Checking for DuckDB WAL files...');

  const walFiles = findFiles(ROOT, [/\.duckdb\.wal$/], ['node_modules', 'dist', '.git', 'data']);
  for (const file of walFiles) {
    violations.push({
      file: file.replace(ROOT + '/', ''),
      reason: 'DuckDB WAL file found (runtime state, should not be committed)',
    });
  }
}

/**
 * Check for logs directory
 */
function checkLogsDirectory(): void {
  console.log('🔍 Checking for logs/ directory...');

  const logsDir = join(ROOT, 'logs');
  if (statSync(logsDir, { throwIfNoEntry: false })?.isDirectory()) {
    violations.push({
      file: 'logs/',
      reason: 'logs/ directory found (runtime state, should not be committed)',
    });
  }
}

/**
 * Check for junk files
 */
function checkJunkFiles(): void {
  console.log('🔍 Checking for junk files...');

  const junkPatterns = [
    /^--dbPath$/,
    /.*--dbPath.*/,
    /^integration_test_.*\.duckdb$/,
    /^integration_test_.*\.duckdb\.wal$/,
    /^.*_test_.*\.duckdb$/,
    /^.*_test_.*\.duckdb\.wal$/,
    /^chain_detection_test_.*\.duckdb$/,
    /^invalid_groups_test_.*\.duckdb$/,
  ];

  const rootFiles = readdirSync(ROOT, { withFileTypes: true })
    .filter((dirent) => dirent.isFile())
    .map((dirent) => dirent.name);

  for (const fileName of rootFiles) {
    for (const pattern of junkPatterns) {
      if (pattern.test(fileName)) {
        violations.push({
          file: fileName,
          reason: 'Junk file found at repo root (runtime state, should not be committed)',
        });
        break;
      }
    }
  }
}

/**
 * Main check function
 */
function main(): void {
  console.log('🚀 Running build artifact checks...\n');

  checkBuildArtifactsInSrc();
  checkDuckdbWalFiles();
  checkLogsDirectory();
  checkJunkFiles();

  if (violations.length > 0) {
    console.error('\n❌ Build artifact violations found:\n');
    for (const violation of violations) {
      console.error(`  ${violation.file}`);
      console.error(`    Reason: ${violation.reason}\n`);
    }
    console.error(
      `\n💡 Fix: Remove these files and ensure .gitignore rules are in place.\n` +
        `   Run: git rm --cached <file> for tracked files.\n`
    );
    process.exit(1);
  }

  console.log('✅ No build artifacts found in source directories\n');
}

main();
