#!/usr/bin/env tsx

/**
 * AST-Based Boundary Enforcement
 *
 * Uses TypeScript compiler API to parse source files and detect forbidden imports
 * at the AST level. More accurate than regex-based checks.
 *
 * Detects:
 * - Forbidden imports between packages
 * - Deep imports from @quantbot packages
 * - CLI/workflow boundary violations
 * - Storage implementation imports in workflows
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..', '..');
const ROOT = __dirname;

interface Violation {
  file: string;
  line: number;
  column: number;
  message: string;
  importPath: string;
}

const violations: Violation[] = [];

/**
 * Forbidden import patterns
 */
const FORBIDDEN_PATTERNS = [
  // Workflows cannot import from CLI/TUI
  {
    target: 'packages/workflows/src/**/*.ts',
    forbidden: [
      {
        pattern: /^@quantbot\/cli/,
        message: 'Workflows cannot depend on CLI. Use WorkflowContext for all dependencies.',
      },
      {
        pattern: /^@quantbot\/tui/,
        message: 'Workflows cannot depend on TUI. Use WorkflowContext for all dependencies.',
      },
    ],
  },
  // Workflows cannot import storage implementations
  {
    target: 'packages/workflows/src/**/*.ts',
    forbidden: [
      {
        pattern: /@quantbot\/storage\/src\/(postgres|clickhouse|duckdb)/,
        message: 'Use WorkflowContext repos, not direct storage implementation imports',
      },
    ],
  },
  // CLI handlers cannot import workflow internals
  {
    target: 'packages/cli/src/handlers/**/*.ts',
    forbidden: [
      {
        pattern: /@quantbot\/workflows\/src/,
        message: 'CLI handlers cannot import workflow internals. Use public API only.',
      },
    ],
  },
  // No deep imports from any @quantbot package
  {
    target: 'packages/**/src/**/*.ts',
    forbidden: [
      {
        pattern: /@quantbot\/[^/]+\/src\//,
        message: 'Deep import detected. Use public API (@quantbot/<pkg>) instead.',
      },
    ],
  },
];

/**
 * Check if a file path matches a target pattern
 */
function matchesTarget(filePath: string, target: string): boolean {
  // Convert glob pattern to regex
  const pattern = target.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\//g, '\\/');
  const regex = new RegExp(`^${pattern}$`);
  return regex.test(filePath);
}

/**
 * Extract import statements from TypeScript source using AST
 */
function extractImports(
  sourceFile: ts.SourceFile
): Array<{ path: string; line: number; column: number }> {
  const imports: Array<{ path: string; line: number; column: number }> = [];

  function visit(node: ts.Node): void {
    // Check for import declarations
    if (
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const importPath = node.moduleSpecifier.text;
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      imports.push({
        path: importPath,
        line: line + 1, // 1-indexed
        column: character + 1,
      });
    }

    // Check for require() calls (CommonJS)
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require'
    ) {
      const firstArg = node.arguments[0];
      if (firstArg && ts.isStringLiteral(firstArg)) {
        const importPath = firstArg.text;
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        imports.push({
          path: importPath,
          line: line + 1,
          column: character + 1,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

/**
 * Check a single file for boundary violations
 */
function checkFile(filePath: string): void {
  // Skip test files for some checks (they may need deep imports for testing)
  const isTestFile = filePath.includes('.test.') || filePath.includes('.spec.');

  const content = readFileSync(filePath, 'utf-8');

  // Create TypeScript source file
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

  // Extract all imports
  const imports = extractImports(sourceFile);

  // Check each import against forbidden patterns
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (!matchesTarget(filePath, pattern.target)) {
      continue;
    }

    for (const importInfo of imports) {
      for (const forbidden of pattern.forbidden) {
        if (forbidden.pattern.test(importInfo.path)) {
          // Skip test files for some patterns (allow deep imports in tests)
          if (isTestFile && forbidden.pattern.source.includes('/src/')) {
            continue;
          }

          violations.push({
            file: filePath.replace(ROOT + '/', ''),
            line: importInfo.line,
            column: importInfo.column,
            message: forbidden.message,
            importPath: importInfo.path,
          });
        }
      }
    }
  }
}

/**
 * Find all TypeScript files recursively
 */
function findTsFiles(dir: string, baseDir: string = dir): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip excluded directories
      if (
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === '.git' ||
        entry.name === 'coverage'
      ) {
        continue;
      }
      files.push(...findTsFiles(fullPath, baseDir));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      // Skip .d.ts files
      if (!entry.name.endsWith('.d.ts')) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

/**
 * Main check function
 */
function main(): void {
  console.log('🔍 Running AST-based boundary enforcement checks...\n');

  const packagesDir = join(ROOT, 'packages');
  if (!statSync(packagesDir, { throwIfNoEntry: false })?.isDirectory()) {
    console.log('⚠️  No packages directory found, skipping check');
    process.exit(0);
  }

  // Find all TypeScript files
  const files = findTsFiles(packagesDir);
  console.log(`📋 Checking ${files.length} files...\n`);

  // Check each file
  for (const file of files) {
    try {
      checkFile(file);
    } catch (error) {
      console.error(`⚠️  Error checking ${file}:`, error);
    }
  }

  // Report results
  if (violations.length === 0) {
    console.log('✅ All boundary checks passed!\n');
    process.exit(0);
  } else {
    console.error(`\n❌ Found ${violations.length} boundary violation(s):\n`);

    violations.forEach((violation, index) => {
      console.error(`${index + 1}. ${violation.file}:${violation.line}:${violation.column}`);
      console.error(`   Import: ${violation.importPath}`);
      console.error(`   ${violation.message}\n`);
    });

    console.error('\n💡 Fix these violations by:');
    console.error('   - Using public API imports (@quantbot/<pkg>) instead of deep imports');
    console.error('   - Using WorkflowContext for workflows instead of direct imports');
    console.error('   - Ensuring handlers only use public APIs\n');

    process.exit(1);
  }
}

main();
