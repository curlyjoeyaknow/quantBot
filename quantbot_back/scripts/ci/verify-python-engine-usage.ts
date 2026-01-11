#!/usr/bin/env tsx

/**
 * Verify PythonEngine Usage
 *
 * Ensures PythonEngine is only imported in allowed locations:
 * - packages/storage/**
 * - tools/storage/**
 *
 * All other packages must use storage ports/services instead.
 * See docs/architecture/PYTHON_DB_DRIVER_DECISION.md for details.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..', '..', '..'); // scripts/ci -> scripts -> repo root
const ROOT = __dirname;

interface Violation {
  file: string;
  line: number;
  import: string;
  reason: string;
}

const violations: Violation[] = [];

/**
 * Allowed locations for PythonEngine imports
 */
const ALLOWED_PATHS = [
  'packages/storage',
  'tools/storage',
  'packages/utils', // PythonEngine is defined here
];

/**
 * Check if a file path is in an allowed location
 */
function isAllowedPath(filePath: string): boolean {
  const relativePath = relative(ROOT, filePath);
  return ALLOWED_PATHS.some((allowed) => relativePath.startsWith(allowed));
}

/**
 * Find PythonEngine imports in a file
 */
function findPythonEngineImports(filePath: string, content: string): void {
  const lines = content.split('\n');

  // More comprehensive patterns to catch all import styles
  const pythonEnginePatterns = [
    // Named imports: import { PythonEngine } from '@quantbot/utils'
    /import\s+\{[^}]*PythonEngine[^}]*\}\s+from\s+['"]@quantbot\/utils['"]/,
    // Named imports: import { getPythonEngine } from '@quantbot/utils'
    /import\s+\{[^}]*getPythonEngine[^}]*\}\s+from\s+['"]@quantbot\/utils['"]/,
    // Default import: import PythonEngine from '@quantbot/utils'
    /import\s+PythonEngine\s+from\s+['"]@quantbot\/utils['"]/,
    // Dynamic import: const { PythonEngine } = await import('@quantbot/utils')
    /const\s+\{[^}]*PythonEngine[^}]*\}\s*=\s*await\s+import\s*\(['"]@quantbot\/utils['"]\)/,
    // Dynamic import: const { getPythonEngine } = await import('@quantbot/utils')
    /const\s+\{[^}]*getPythonEngine[^}]*\}\s*=\s*await\s+import\s*\(['"]@quantbot\/utils['"]\)/,
    // Direct path imports
    /from\s+['"]@quantbot\/utils\/python\/python-engine['"]/,
    /from\s+['"]@quantbot\/utils\/python\/python-engine\.js['"]/,
  ];

  lines.forEach((line, index) => {
    // Skip comments (but allow imports in comments to be checked - they shouldn't be there anyway)
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('//') && !trimmedLine.includes('import')) {
      return;
    }

    for (const pattern of pythonEnginePatterns) {
      if (pattern.test(line)) {
        // Check if this is in an allowed location
        const relativeFilePath = relative(ROOT, filePath);
        if (!isAllowedPath(filePath)) {
          violations.push({
            file: relativeFilePath,
            line: index + 1,
            import: line.trim(),
            reason:
              'PythonEngine may only be imported in packages/storage and tools/storage. Use storage ports/services instead.',
          });
          break; // Only report once per line
        }
      }
    }
  });
}

/**
 * Recursively find TypeScript files
 * Returns absolute paths
 */
function findTsFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) {
    return files;
  }

  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip node_modules, dist, .git
      if (['node_modules', 'dist', '.git', 'coverage'].includes(entry.name)) {
        continue;
      }
      files.push(...findTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Main verification function
 */
function verifyPythonEngineUsage(): void {
  console.log('🔍 Verifying PythonEngine usage restrictions...\n');

  let totalFilesChecked = 0;

  // Check packages directory
  const packagesDir = join(ROOT, 'packages');
  if (existsSync(packagesDir)) {
    const packages = readdirSync(packagesDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    for (const pkg of packages) {
      const pkgSrcDir = join(packagesDir, pkg, 'src');
      if (!existsSync(pkgSrcDir)) {
        continue;
      }

      const files = findTsFiles(pkgSrcDir);
      totalFilesChecked += files.length;
      for (const fullPath of files) {
        const content = readFileSync(fullPath, 'utf-8');
        findPythonEngineImports(fullPath, content);
      }

      // Also check test files
      const pkgTestsDir = join(packagesDir, pkg, 'tests');
      if (existsSync(pkgTestsDir)) {
        const testFiles = findTsFiles(pkgTestsDir);
        for (const fullPath of testFiles) {
          const content = readFileSync(fullPath, 'utf-8');
          findPythonEngineImports(fullPath, content);
        }
      }
    }
  }

  // Check tools directory
  const toolsDir = join(ROOT, 'tools');
  if (existsSync(toolsDir)) {
    const tools = readdirSync(toolsDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    for (const tool of tools) {
      const toolDir = join(toolsDir, tool);
      if (!existsSync(toolDir)) {
        continue;
      }

      const files = findTsFiles(toolDir);
      for (const fullPath of files) {
        const content = readFileSync(fullPath, 'utf-8');
        findPythonEngineImports(fullPath, content);
      }
    }
  }

  if (violations.length === 0) {
    console.log(
      `✅ All PythonEngine imports are in allowed locations! (checked ${totalFilesChecked} files)\n`
    );
    return;
  }

  console.log(`📊 Checked ${totalFilesChecked} files\n`);

  console.error('❌ PythonEngine import violations found:\n');
  violations.forEach((v) => {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.import}`);
    console.error(`    Reason: ${v.reason}\n`);
  });

  console.error('\n💡 Fix by:');
  console.error('   - Moving PythonEngine usage to packages/storage or tools/storage');
  console.error('   - Using storage ports/services instead of direct PythonEngine imports');
  console.error('   - See docs/architecture/PYTHON_DB_DRIVER_DECISION.md for details\n');

  process.exit(1);
}

verifyPythonEngineUsage();
