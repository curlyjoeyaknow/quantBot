#!/usr/bin/env tsx

/**
 * Python Boundary Enforcement
 *
 * Verifies that tools/shared/* does not import from tools/storage/*
 * This enforces the boundary rule: shared libs must not depend on app layer.
 *
 * Uses simple regex-based checks (Python AST parsing would require Python runtime).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..', '..', '..');
const ROOT = __dirname;

interface Violation {
  file: string;
  line: number;
  message: string;
}

const violations: Violation[] = [];

/**
 * Find all Python files recursively
 */
function findPythonFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip common non-source directories
      if (
        entry.name === '__pycache__' ||
        entry.name === '.pytest_cache' ||
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === 'build'
      ) {
        continue;
      }
      files.push(...findPythonFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.py')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Check tools/shared/* files for forbidden imports from tools/storage/*
 */
function checkSharedBoundaries(): void {
  const sharedDir = join(ROOT, 'tools', 'shared');
  if (!statSync(sharedDir, { throwIfNoEntry: false })?.isDirectory()) {
    console.log('⚠️  No tools/shared directory found, skipping Python boundary check');
    return;
  }

  const sharedFiles = findPythonFiles(sharedDir);
  console.log(
    `\n📋 Checking ${sharedFiles.length} Python files in tools/shared/ for boundary violations...`
  );

  for (const file of sharedFiles) {
    const content = readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      const lineNum = index + 1;

      // Check for imports from tools/storage
      // Matches: from tools.storage, import tools.storage, from tools/storage
      const storageImportPatterns = [
        /from\s+tools\.storage/,
        /from\s+tools\/storage/,
        /import\s+tools\.storage/,
        /import\s+tools\/storage/,
      ];

      for (const pattern of storageImportPatterns) {
        if (pattern.test(line)) {
          violations.push({
            file: file.replace(ROOT + '/', ''),
            line: lineNum,
            message: `tools/shared/* must not import from tools/storage/*. Shared libs must not depend on app layer. See tools/shared/README.md`,
          });
        }
      }
    });
  }
}

/**
 * Main test runner
 */
function main(): void {
  console.log('🐍 Python Boundary Enforcement Tests\n');
  console.log('='.repeat(60));

  checkSharedBoundaries();

  console.log('\n' + '='.repeat(60));

  if (violations.length === 0) {
    console.log('✅ All Python boundary checks passed!');
    process.exit(0);
  } else {
    console.log(`\n❌ Found ${violations.length} Python boundary violation(s):\n`);

    violations.forEach((violation, index) => {
      console.log(`${index + 1}. ${violation.file}:${violation.line}`);
      console.log(`   ${violation.message}\n`);
    });

    console.log('\n💡 Fix these violations by:');
    console.log("   - Moving shared code to tools/shared/ if it's truly shared");
    console.log("   - Removing the import if it's not needed");
    console.log('   - Restructuring if tools/storage needs to use tools/shared instead\n');

    process.exit(1);
  }
}

main();
