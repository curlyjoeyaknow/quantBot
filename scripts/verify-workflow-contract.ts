#!/usr/bin/env tsx

/**
 * Workflow Contract Compliance Verification
 * ==========================================
 *
 * Verifies that workflows and CLI handlers follow the workflow contract:
 * 1. Workflow signatures use default parameter pattern for ctx
 * 2. No forbidden imports (ESLint handles this, but we verify here too)
 * 3. CLI handlers don't contain orchestration logic
 * 4. Workflow results are JSON-serializable (basic checks)
 *
 * This script is designed to run in CI and can be added to pre-commit hooks.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

interface Violation {
  file: string;
  line: number;
  violation: string;
  severity: 'error' | 'warning';
}

const violations: Violation[] = [];

/**
 * Check if a workflow function uses default parameter pattern for ctx
 */
function checkWorkflowSignature(content: string, file: string): void {
  // Match workflow function signatures
  // Pattern: export async function workflowName(spec: Type, ctx: ContextType = createDefault...())
  const workflowFunctionRegex = /export\s+async\s+function\s+(\w+)\s*\([^)]+\)/g;
  const lines = content.split('\n');

  let match;
  while ((match = workflowFunctionRegex.exec(content)) !== null) {
    const functionName = match[1];
    const matchLine = content.substring(0, match.index).split('\n').length;

    // Skip test files and helper functions
    if (file.includes('.test.') || file.includes('.spec.')) {
      continue;
    }

    // Check if this looks like a workflow function (starts with run, ingest, etc.)
    const isWorkflowFunction =
      functionName.startsWith('run') ||
      functionName.startsWith('ingest') ||
      functionName.startsWith('query') ||
      functionName.startsWith('simulate');

    if (!isWorkflowFunction) {
      continue;
    }

    // Extract the function signature
    const functionStart = match.index;
    const functionEnd = findFunctionEnd(content, functionStart);
    const functionBody = content.substring(functionStart, functionEnd);

    // Check for ctx parameter with default value
    const hasDefaultCtx = /ctx\s*:\s*\w+Context\s*=\s*create\w+Context\(\)/.test(functionBody);

    // Check for ctx parameter without default (but allow if it's required)
    const hasCtxParam = /ctx\s*:\s*\w+Context/.test(functionBody);

    if (hasCtxParam && !hasDefaultCtx) {
      // Check if it's a required parameter (no default) - this is acceptable for some workflows
      // But we prefer default parameter pattern
      const ctxParamMatch = functionBody.match(/ctx\s*:\s*(\w+Context)(\s*=\s*[^,)]+)?/);
      if (ctxParamMatch && !ctxParamMatch[2]) {
        violations.push({
          file,
          line: matchLine,
          violation: `Workflow function "${functionName}" should use default parameter pattern: ctx: ContextType = createDefaultContext()`,
          severity: 'warning',
        });
      }
    }

    // Check for forbidden pattern: ctx = ctx ?? createDefaultContext()
    if (/ctx\s*=\s*ctx\s*\?\?/.test(functionBody)) {
      violations.push({
        file,
        line: matchLine,
        violation: `Workflow function "${functionName}" uses forbidden pattern: ctx = ctx ?? createDefaultContext(). Use default parameter instead.`,
        severity: 'error',
      });
    }
  }
}

/**
 * Find the end of a function (simple heuristic)
 */
function findFunctionEnd(content: string, start: number): number {
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let i = start;

  while (i < content.length) {
    const char = content[i];
    const nextChar = content[i + 1];

    // Handle strings
    if (!inString && (char === '"' || char === "'" || char === '`')) {
      inString = true;
      stringChar = char;
    } else if (inString && char === stringChar && content[i - 1] !== '\\') {
      inString = false;
    }

    if (!inString) {
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          return i + 1;
        }
      }
    }

    i++;
  }

  return content.length;
}

/**
 * Check CLI handlers for orchestration logic
 */
function checkCliHandler(content: string, file: string): void {
  const lines = content.split('\n');

  // Patterns that suggest orchestration logic (multi-step flows)
  const orchestrationPatterns = [
    {
      pattern: /for\s*\([^)]+\)\s*\{[^}]*await[^}]*await[^}]*\}/s,
      message: 'CLI handler contains loop with multiple await calls (orchestration logic)',
    },
    {
      pattern: /while\s*\([^)]+\)\s*\{[^}]*await[^}]*await[^}]*\}/s,
      message: 'CLI handler contains while loop with multiple await calls (orchestration logic)',
    },
    {
      pattern: /\.then\([^)]*\.then\(/,
      message: 'CLI handler contains promise chaining (orchestration logic)',
    },
  ];

  orchestrationPatterns.forEach(({ pattern, message }) => {
    if (pattern.test(content)) {
      const match = content.match(pattern);
      if (match) {
        const line = content.substring(0, match.index!).split('\n').length;
        violations.push({
          file,
          line,
          violation: message,
          severity: 'error',
        });
      }
    }
  });

  // Check for direct repository calls in loops (suggests orchestration)
  const repoCallInLoop = /(for|while)\s*\([^)]+\)\s*\{[^}]*\.(save|create|insert|update|delete)\(/s;
  if (repoCallInLoop.test(content)) {
    const match = content.match(repoCallInLoop);
    if (match) {
      const line = content.substring(0, match.index!).split('\n').length;
      violations.push({
        file,
        line,
        violation:
          'CLI handler contains repository calls in loops (orchestration logic should be in workflow)',
        severity: 'error',
      });
    }
  }
}

/**
 * Check for forbidden imports
 */
function checkForbiddenImports(content: string, file: string): void {
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    // Check for CLI/TUI imports in workflows
    if (file.includes('packages/workflows/src')) {
      if (/from\s+['"]@quantbot\/(cli|tui)/.test(line)) {
        violations.push({
          file,
          line: index + 1,
          violation: 'Workflow cannot import from CLI or TUI packages',
          severity: 'error',
        });
      }

      // Check for storage implementation imports
      if (/from\s+['"].*storage.*\/(postgres|clickhouse|duckdb)/.test(line)) {
        violations.push({
          file,
          line: index + 1,
          violation:
            'Workflow cannot import storage implementations directly. Use WorkflowContext.',
          severity: 'error',
        });
      }
    }

    // Check for workflow internals in CLI handlers
    if (file.includes('packages/cli/src/handlers')) {
      if (/from\s+['"]@quantbot\/workflows\/src/.test(line)) {
        violations.push({
          file,
          line: index + 1,
          violation: 'CLI handler cannot import workflow internals. Use public API only.',
          severity: 'error',
        });
      }
    }
  });
}

/**
 * Check for non-serializable types in result types
 */
function checkResultSerialization(content: string, file: string): void {
  // Look for result type definitions
  const resultTypeRegex = /export\s+type\s+(\w+Result)\s*=/g;
  let match;

  while ((match = resultTypeRegex.exec(content)) !== null) {
    const typeName = match[1];
    const typeStart = match.index;
    const typeEnd = findTypeEnd(content, typeStart);
    const typeBody = content.substring(typeStart, typeEnd);

    // Check for Date objects (should use ISO strings)
    if (/:\s*Date\s*[;,]/.test(typeBody)) {
      const line = content.substring(0, typeStart).split('\n').length;
      violations.push({
        file,
        line,
        violation: `Result type "${typeName}" contains Date objects. Use ISO strings (DateTime.toISO()) instead.`,
        severity: 'error',
      });
    }

    // Check for class instances (basic check)
    if (/:\s*(Map|Set|WeakMap|WeakSet)\s*</.test(typeBody)) {
      const line = content.substring(0, typeStart).split('\n').length;
      violations.push({
        file,
        line,
        violation: `Result type "${typeName}" contains non-serializable types (Map/Set). Convert to arrays/objects.`,
        severity: 'warning',
      });
    }
  }
}

/**
 * Find the end of a type definition
 */
function findTypeEnd(content: string, start: number): number {
  let depth = 0;
  let i = start;

  while (i < content.length) {
    const char = content[i];

    if (char === '{' || char === '(') {
      depth++;
    } else if (char === '}' || char === ')') {
      depth--;
      if (depth === 0 && char === '}') {
        return i + 1;
      }
    } else if (char === ';' && depth === 0) {
      return i + 1;
    }

    i++;
  }

  return content.length;
}

/**
 * Recursively find all TypeScript files in a directory
 */
function findTsFiles(dir: string, ignorePatterns: string[] = []): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    // Skip ignored patterns
    if (ignorePatterns.some((pattern) => entry.name.includes(pattern))) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...findTsFiles(fullPath, ignorePatterns));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Main verification function
 */
function verifyWorkflowContracts(): void {
  console.log('🔍 Verifying workflow contract compliance...\n');

  // Find all workflow files
  const workflowDir = join(process.cwd(), 'packages/workflows/src');
  const workflowFiles = findTsFiles(workflowDir, ['.test.', '.spec.']).filter(
    (f) => !f.includes('/tests/')
  );

  // Find all CLI handler files (if directory exists)
  const handlerDir = join(process.cwd(), 'packages/cli/src/handlers');
  const handlerFiles = existsSync(handlerDir)
    ? findTsFiles(handlerDir, ['.test.', '.spec.'])
    : [];

  // Check workflow files
  for (const file of workflowFiles) {
    const content = readFileSync(file, 'utf-8');
    checkWorkflowSignature(content, file);
    checkForbiddenImports(content, file);
    checkResultSerialization(content, file);
  }

  // Check CLI handler files
  for (const file of handlerFiles) {
    const content = readFileSync(file, 'utf-8');
    checkCliHandler(content, file);
    checkForbiddenImports(content, file);
  }

  // Report violations
  if (violations.length === 0) {
    console.log('✅ All workflow contracts are compliant!\n');
    return;
  }

  console.error('❌ Workflow contract violations found:\n');

  const errors = violations.filter((v) => v.severity === 'error');
  const warnings = violations.filter((v) => v.severity === 'warning');

  if (errors.length > 0) {
    console.error(`Errors (${errors.length}):`);
    errors.forEach((v) => {
      console.error(`  ${v.file}:${v.line}`);
      console.error(`    ${v.violation}\n`);
    });
  }

  if (warnings.length > 0) {
    console.warn(`Warnings (${warnings.length}):`);
    warnings.forEach((v) => {
      console.warn(`  ${v.file}:${v.line}`);
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
  verifyWorkflowContracts();
} catch (error) {
  console.error('❌ Verification failed:', error);
  process.exit(1);
}
