#!/usr/bin/env tsx

/**
 * AST-Based Boundary Enforcement
 * ==============================
 *
 * Uses TypeScript compiler API to parse and analyze imports, replacing regex-based checks.
 * This provides accurate, reliable boundary enforcement that understands TypeScript syntax.
 *
 * Checks:
 * 1. Forbidden imports (packages cannot import forbidden dependencies)
 * 2. Deep imports (cannot import from src/dist/build/lib paths)
 * 3. Path alias violations (cannot bypass package exports)
 * 4. Tests are also checked (no exceptions)
 */

import * as ts from 'typescript';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface Violation {
  file: string;
  line: number;
  column: number;
  violation: string;
  severity: 'error' | 'warning';
  importPath: string;
}

const violations: Violation[] = [];

/**
 * Package boundary rules
 *
 * Enforces layer boundaries:
 * - Simulation (Strategy Logic) cannot import from ingestion/api-clients/ohlcv/storage
 * - Analytics (Feature Engineering) cannot import from api-clients/ingestion
 * - OHLCV (Feature Engineering) cannot import from api-clients/ingestion/simulation
 * - Workflows cannot import from CLI/TUI
 */
const PACKAGE_BOUNDARIES: Record<string, { forbidden: string[]; allowed?: string[] }> = {
  '@quantbot/simulation': {
    forbidden: [
      '@quantbot/storage',
      '@quantbot/api-clients',
      '@quantbot/ohlcv',
      '@quantbot/ingestion',
    ],
  },
  '@quantbot/workflows': {
    forbidden: ['@quantbot/cli', '@quantbot/tui'],
  },
  '@quantbot/ohlcv': {
    forbidden: ['@quantbot/api-clients', '@quantbot/ingestion', '@quantbot/simulation'],
  },
  '@quantbot/analytics': {
    forbidden: ['@quantbot/api-clients', '@quantbot/ingestion'],
  },
};

/**
 * Forbidden deep import patterns
 */
const FORBIDDEN_DEEP_IMPORTS = [
  /@quantbot\/\w+\/(src|dist|build|lib)\//,
  /@quantbot\/\w+\/(src|dist|build|lib)$/,
];

/**
 * Network-related imports (forbidden in simulation)
 */
const NETWORK_IMPORTS = ['axios', 'node-fetch', 'got', 'http', 'https', 'node:http', 'node:https'];

/**
 * Forbidden storage implementation imports (for workflows)
 * Workflows must use WorkflowContext repos, not direct storage implementations
 */
const FORBIDDEN_STORAGE_IMPORTS = [/@quantbot\/storage\/src\/(postgres|clickhouse|duckdb)/];

/**
 * Find all TypeScript files in a directory
 */
function findTsFiles(dir: string, baseDir: string = dir): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) {
    return files;
  }

  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Skip node_modules and dist directories
      if (entry === 'node_modules' || entry === 'dist' || entry === 'build') {
        continue;
      }
      files.push(...findTsFiles(fullPath, baseDir));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(relative(baseDir, fullPath));
    }
  }

  return files;
}

/**
 * Get package name from file path
 */
function getPackageName(filePath: string): string | null {
  const match = filePath.match(/packages\/([^/]+)/);
  if (match) {
    return `@quantbot/${match[1]}`;
  }
  return null;
}

/**
 * Parse TypeScript file and extract imports using compiler API
 */
function parseImports(
  filePath: string,
  content: string
): Array<{
  line: number;
  column: number;
  moduleSpecifier: string;
  kind: 'import' | 'require' | 'dynamic';
}> {
  const imports: Array<{
    line: number;
    column: number;
    moduleSpecifier: string;
    kind: 'import' | 'require' | 'dynamic';
  }> = [];

  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

  function visit(node: ts.Node): void {
    // Handle import declarations: import ... from 'module'
    if (
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const moduleSpecifier = node.moduleSpecifier.text;
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      const { character } = sourceFile.getLineAndCharacterOfPosition(
        node.moduleSpecifier.getStart()
      );

      imports.push({
        line: line + 1, // 1-based line numbers
        column: character + 1, // 1-based column numbers
        moduleSpecifier,
        kind: 'import',
      });
    }

    // Handle require calls: require('module')
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require'
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) {
        const moduleSpecifier = arg.text;
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        const { character } = sourceFile.getLineAndCharacterOfPosition(arg.getStart());

        imports.push({
          line: line + 1,
          column: character + 1,
          moduleSpecifier,
          kind: 'require',
        });
      }
    }

    // Handle dynamic imports: import('module')
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) {
        const moduleSpecifier = arg.text;
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        const { character } = sourceFile.getLineAndCharacterOfPosition(arg.getStart());

        imports.push({
          line: line + 1,
          column: character + 1,
          moduleSpecifier,
          kind: 'dynamic',
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return imports;
}

/**
 * Check package boundary violations
 */
function checkPackageBoundaries(
  filePath: string,
  imports: Array<{ moduleSpecifier: string; line: number; column: number }>
): void {
  const packageName = getPackageName(filePath);
  if (!packageName) {
    return;
  }

  const rules = PACKAGE_BOUNDARIES[packageName];
  if (!rules) {
    return;
  }

  for (const imp of imports) {
    const moduleSpecifier = imp.moduleSpecifier;

    // Check forbidden packages
    for (const forbidden of rules.forbidden) {
      if (moduleSpecifier === forbidden || moduleSpecifier.startsWith(`${forbidden}/`)) {
        violations.push({
          file: filePath,
          line: imp.line,
          column: imp.column,
          violation: `Package ${packageName} cannot import ${forbidden}`,
          severity: 'error',
          importPath: moduleSpecifier,
        });
      }
    }

    // Check network imports (for simulation package)
    if (packageName === '@quantbot/simulation') {
      for (const networkImport of NETWORK_IMPORTS) {
        if (moduleSpecifier === networkImport || moduleSpecifier.startsWith(`${networkImport}/`)) {
          violations.push({
            file: filePath,
            line: imp.line,
            column: imp.column,
            violation: `Package ${packageName} cannot import network-related modules (${networkImport})`,
            severity: 'error',
            importPath: moduleSpecifier,
          });
        }
      }
    }
  }
}

/**
 * Check deep import violations
 */
function checkDeepImports(
  filePath: string,
  imports: Array<{ moduleSpecifier: string; line: number; column: number }>
): void {
  for (const imp of imports) {
    const moduleSpecifier = imp.moduleSpecifier;

    // Check forbidden deep import patterns
    for (const pattern of FORBIDDEN_DEEP_IMPORTS) {
      if (pattern.test(moduleSpecifier)) {
        violations.push({
          file: filePath,
          line: imp.line,
          column: imp.column,
          violation: `Deep import detected: ${moduleSpecifier}. Use package public API instead.`,
          severity: 'error',
          importPath: moduleSpecifier,
        });
      }
    }
  }
}

/**
 * Check path alias violations
 *
 * Path aliases in tsconfig.json point to src/ directories for development,
 * but imports from OTHER packages should use package public APIs (package index) at runtime.
 * This check ensures cross-package imports don't bypass package boundaries via path aliases.
 *
 * Note: Same-package deep imports are allowed (internal to the package).
 */
function checkPathAliasViolations(
  filePath: string,
  imports: Array<{ moduleSpecifier: string; line: number; column: number }>
): void {
  const currentPackage = getPackageName(filePath);
  if (!currentPackage) {
    return; // Can't determine package, skip check
  }

  for (const imp of imports) {
    const moduleSpecifier = imp.moduleSpecifier;

    // Check for path alias imports that bypass package index
    // Pattern: @quantbot/package-name/... (with subpath)
    // Allowed: @quantbot/package-name (package index)
    // Allowed: Same-package deep imports (internal)
    // Forbidden: Cross-package deep imports (bypasses package exports)
    const pathAliasMatch = moduleSpecifier.match(/^@quantbot\/(\w+)(\/(.+))?$/);
    if (pathAliasMatch) {
      const importedPackage = `@quantbot/${pathAliasMatch[1]}`;
      const subpath = pathAliasMatch[3]; // Everything after package name

      // Skip if importing from same package (internal imports are allowed)
      if (importedPackage === currentPackage) {
        continue;
      }

      // If there's a subpath and it's a different package, it's a cross-package deep import
      if (subpath && subpath !== 'index' && !subpath.endsWith('/index')) {
        // Check if it's importing from a known internal path
        const internalPaths = ['src/', 'dist/', 'core/', 'types/', 'strategies/', 'execution/'];
        const isInternalPath = internalPaths.some((path) => subpath.startsWith(path));

        if (isInternalPath) {
          violations.push({
            file: filePath,
            line: imp.line,
            column: imp.column,
            violation: `Path alias bypasses package exports: ${moduleSpecifier}. Use ${importedPackage} (package index) instead, or export the needed function from ${importedPackage}/index.ts.`,
            severity: 'error',
            importPath: moduleSpecifier,
          });
        }
      }
    }
  }
}

/**
 * Check for storage implementation imports in workflows
 *
 * Workflows must use WorkflowContext repos, not direct storage implementations.
 * This prevents workflows from depending on storage implementation details.
 */
function checkStorageImplementationImports(
  filePath: string,
  imports: Array<{ moduleSpecifier: string; line: number; column: number }>
): void {
  const currentPackage = getPackageName(filePath);
  if (currentPackage !== '@quantbot/workflows') {
    return; // Only check workflows package
  }

  for (const imp of imports) {
    const moduleSpecifier = imp.moduleSpecifier;

    // Check for storage implementation imports
    for (const pattern of FORBIDDEN_STORAGE_IMPORTS) {
      if (pattern.test(moduleSpecifier)) {
        violations.push({
          file: filePath,
          line: imp.line,
          column: imp.column,
          violation: `Workflows cannot import storage implementations: ${moduleSpecifier}. Use WorkflowContext repos instead.`,
          severity: 'error',
          importPath: moduleSpecifier,
        });
      }
    }
  }
}

/**
 * Main verification function
 */
function verifyBoundaries(): void {
  console.log('🔍 Verifying architectural boundaries (AST-based)...\n');

  const packagesDir = join(process.cwd(), 'packages');
  if (!existsSync(packagesDir)) {
    console.error('❌ packages directory not found');
    process.exit(1);
  }

  // Find all TypeScript files in packages
  const packages = readdirSync(packagesDir).filter((entry) => {
    const fullPath = join(packagesDir, entry);
    return statSync(fullPath).isDirectory();
  });

  for (const pkg of packages) {
    // Check source files
    const pkgSrcDir = join(packagesDir, pkg, 'src');
    if (existsSync(pkgSrcDir)) {
      const files = findTsFiles(pkgSrcDir, pkgSrcDir);

      for (const file of files) {
        const fullPath = join(pkgSrcDir, file);
        const content = readFileSync(fullPath, 'utf-8');

        // Parse imports using TypeScript compiler API
        const imports = parseImports(fullPath, content);

        // Check boundaries
        checkPackageBoundaries(fullPath, imports);
        checkDeepImports(fullPath, imports);
        checkPathAliasViolations(fullPath, imports);
        checkStorageImplementationImports(fullPath, imports);
      }
    }

    // Check test files (CRITICAL: Tests must also respect boundaries)
    // Test code violations will metastasize to production if not caught
    const pkgTestsDir = join(packagesDir, pkg, 'tests');
    if (existsSync(pkgTestsDir)) {
      const testFiles = findTsFiles(pkgTestsDir, pkgTestsDir);

      for (const file of testFiles) {
        const fullPath = join(pkgTestsDir, file);
        const content = readFileSync(fullPath, 'utf-8');

        // Parse imports using TypeScript compiler API
        const imports = parseImports(fullPath, content);

        // Check boundaries (tests must also respect architectural boundaries)
        checkPackageBoundaries(fullPath, imports);
        checkDeepImports(fullPath, imports);
        checkPathAliasViolations(fullPath, imports);
        checkStorageImplementationImports(fullPath, imports);
      }
    }
  }

  // Report violations
  if (violations.length === 0) {
    console.log('✅ All architectural boundaries are compliant!\n');
    return;
  }

  console.error('❌ Architectural boundary violations found:\n');

  const errors = violations.filter((v) => v.severity === 'error');
  const warnings = violations.filter((v) => v.severity === 'warning');

  if (errors.length > 0) {
    console.error(`Errors (${errors.length}):`);
    errors.forEach((v) => {
      console.error(`  ${v.file}:${v.line}:${v.column}`);
      console.error(`    ${v.violation}`);
      console.error(`    Import: ${v.importPath}\n`);
    });
  }

  if (warnings.length > 0) {
    console.warn(`Warnings (${warnings.length}):`);
    warnings.forEach((v) => {
      console.warn(`  ${v.file}:${v.line}:${v.column}`);
      console.warn(`    ${v.violation}`);
      console.warn(`    Import: ${v.importPath}\n`);
    });
  }

  // Exit with error code if there are errors
  if (errors.length > 0) {
    process.exit(1);
  }
}

// Run verification
try {
  verifyBoundaries();
} catch (error) {
  console.error('❌ Verification failed:', error);
  process.exit(1);
}
