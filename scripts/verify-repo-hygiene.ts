#!/usr/bin/env tsx

/**
 * Repo Hygiene Enforcement
 * =========================
 *
 * CI must fail if:
 * 1. Build artifacts appear in src/ directories
 * 2. Logs/WALs appear anywhere in the repo
 * 3. Path aliases bypass package exports
 * 4. Any runtime state files are committed
 *
 * This ensures the repo stays clean and truthful.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = __filename.substring(0, __filename.lastIndexOf('/'));

interface Violation {
  file: string;
  violation: string;
  severity: 'error' | 'warning';
}

const violations: Violation[] = [];

/**
 * Build artifact patterns (forbidden in src/)
 */
const BUILD_ARTIFACT_PATTERNS = [
  /\.js$/,
  /\.d\.ts$/,
  /\.js\.map$/,
  /\.d\.ts\.map$/,
  /tsconfig\.tsbuildinfo$/,
];

/**
 * Runtime state file patterns (forbidden anywhere)
 */
const RUNTIME_STATE_PATTERNS = [
  /\.log$/,
  /\.wal$/,
  /\.db-shm$/,
  /\.db-wal$/,
  /\.pid$/,
  /\.lock$/,
  /\.tmp$/,
  /\.temp$/,
];

/**
 * Forbidden directories in src/
 */
const FORBIDDEN_SRC_DIRS = ['dist', 'build', 'lib', 'node_modules'];

/**
 * Recursively find files matching patterns
 */
function findFiles(
  dir: string,
  patterns: RegExp[],
  baseDir: string = dir,
  excludeDirs: string[] = []
): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) {
    return files;
  }

  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Skip excluded directories
      if (excludeDirs.includes(entry) || entry.startsWith('.')) {
        continue;
      }
      files.push(...findFiles(fullPath, patterns, baseDir, excludeDirs));
    } else if (stat.isFile()) {
      // Check if file matches any pattern
      for (const pattern of patterns) {
        if (pattern.test(entry)) {
          files.push(relative(baseDir, fullPath));
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
  const packagesDir = join(process.cwd(), 'packages');
  if (!existsSync(packagesDir)) {
    return;
  }

  const packages = readdirSync(packagesDir).filter((entry) => {
    const fullPath = join(packagesDir, entry);
    return statSync(fullPath).isDirectory();
  });

  for (const pkg of packages) {
    const srcDir = join(packagesDir, pkg, 'src');
    if (!existsSync(srcDir)) {
      continue;
    }

    // Find build artifacts in src/
    const artifacts = findFiles(srcDir, BUILD_ARTIFACT_PATTERNS, srcDir, ['node_modules']);

    for (const artifact of artifacts) {
      violations.push({
        file: join('packages', pkg, 'src', artifact),
        violation: `Build artifact found in src/ directory: ${artifact}`,
        severity: 'error',
      });
    }

    // Check for forbidden directories in src/
    const srcEntries = readdirSync(srcDir);
    for (const entry of srcEntries) {
      const fullPath = join(srcDir, entry);
      if (statSync(fullPath).isDirectory() && FORBIDDEN_SRC_DIRS.includes(entry)) {
        violations.push({
          file: join('packages', pkg, 'src', entry),
          violation: `Forbidden directory in src/: ${entry}`,
          severity: 'error',
        });
      }
    }
  }
}

/**
 * Check for runtime state files
 */
function checkRuntimeStateFiles(): void {
  const repoRoot = process.cwd();

  // Find runtime state files (excluding node_modules and .git)
  const stateFiles = findFiles(repoRoot, RUNTIME_STATE_PATTERNS, repoRoot, [
    'node_modules',
    '.git',
    'dist',
    'build',
  ]);

  for (const file of stateFiles) {
    // Allow some runtime files in specific locations (e.g., test fixtures)
    if (file.includes('/tests/') || file.includes('/test/') || file.includes('/fixtures/')) {
      continue;
    }

    violations.push({
      file,
      violation: `Runtime state file found: ${file}`,
      severity: 'error',
    });
  }
}

/**
 * Check for path alias violations (imports that bypass package exports)
 */
function checkPathAliasViolations(): void {
  const packagesDir = join(process.cwd(), 'packages');
  if (!existsSync(packagesDir)) {
    return;
  }

  const packages = readdirSync(packagesDir).filter((entry) => {
    const fullPath = join(packagesDir, entry);
    return statSync(fullPath).isDirectory();
  });

  for (const pkg of packages) {
    const srcDir = join(packagesDir, pkg, 'src');
    if (!existsSync(srcDir)) {
      continue;
    }

    // Find all TypeScript files
    const tsFiles = findFiles(srcDir, [/\.ts$/], srcDir, ['node_modules', 'dist', 'build']);

    for (const file of tsFiles) {
      const fullPath = join(srcDir, file);
      const content = readFileSync(fullPath, 'utf-8');

      // Check for deep imports using path aliases
      // Pattern: @quantbot/package-name/src/... or @quantbot/package-name/dist/...
      const deepImportRegex = /from\s+['"]@quantbot\/(\w+)\/(src|dist|build|lib)(\/.*)?['"]/g;
      let match;

      while ((match = deepImportRegex.exec(content)) !== null) {
        const packageName = match[1];
        const pathType = match[2];
        const importPath = match[0];

        violations.push({
          file: join('packages', pkg, 'src', file),
          violation: `Path alias bypasses package exports: ${importPath}. Use @quantbot/${packageName} instead.`,
          severity: 'error',
        });
      }
    }
  }
}

/**
 * Check for DuckDB WAL files
 */
function checkDuckDBWALs(): void {
  const repoRoot = process.cwd();

  // Find .wal files (DuckDB write-ahead log files)
  const walFiles = findFiles(repoRoot, [/\.wal$/], repoRoot, ['node_modules', '.git']);

  for (const file of walFiles) {
    // Allow WAL files in test fixtures or data directories (but warn)
    if (file.includes('/tests/') || file.includes('/test/') || file.includes('/fixtures/')) {
      violations.push({
        file,
        violation: `DuckDB WAL file found: ${file}. WAL files should not be committed.`,
        severity: 'warning',
      });
    } else {
      violations.push({
        file,
        violation: `DuckDB WAL file found: ${file}. WAL files should not be committed.`,
        severity: 'error',
      });
    }
  }
}

/**
 * Main verification function
 */
function verifyRepoHygiene(): void {
  console.log('🔍 Verifying repo hygiene...\n');

  checkBuildArtifactsInSrc();
  checkRuntimeStateFiles();
  checkPathAliasViolations();
  checkDuckDBWALs();

  // Report violations
  if (violations.length === 0) {
    console.log('✅ Repo hygiene is clean!\n');
    return;
  }

  console.error('❌ Repo hygiene violations found:\n');

  const errors = violations.filter((v) => v.severity === 'error');
  const warnings = violations.filter((v) => v.severity === 'warning');

  if (errors.length > 0) {
    console.error(`Errors (${errors.length}):`);
    errors.forEach((v) => {
      console.error(`  ${v.file}`);
      console.error(`    ${v.violation}\n`);
    });
  }

  if (warnings.length > 0) {
    console.warn(`Warnings (${warnings.length}):`);
    warnings.forEach((v) => {
      console.warn(`  ${v.file}`);
      console.warn(`    ${v.violation}\n`);
    });
  }

  // Exit with error code if there are errors
  if (errors.length > 0) {
    process.exit(1);
  }
}

// Run verification
try {
  verifyRepoHygiene();
} catch (error) {
  console.error('❌ Verification failed:', error);
  process.exit(1);
}
