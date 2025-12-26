#!/usr/bin/env node
/**
 * Handler Tests Verification Script
 *
 * Verifies that all CLI handlers have proper tests following the handler contract.
 *
 * Requirements:
 * - Every handler must have a test file
 * - Tests must verify: parameter conversion, error propagation, service calls
 * - Handlers must not use: console.log, process.exit, try/catch, output formatting
 *
 * Run: tsx scripts/ci/verify-handler-tests.ts
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '../..');

const handlersDir = join(projectRoot, 'packages/cli/src/handlers');
const testsDir = join(projectRoot, 'packages/cli/tests/unit/handlers');

function getAllHandlers(): string[] {
  const handlers: string[] = [];

  function walkDir(dir: string, baseDir: string = dir): void {
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        walkDir(fullPath, baseDir);
      } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
        handlers.push(fullPath.replace(baseDir + '/', ''));
      }
    }
  }

  walkDir(handlersDir, handlersDir);
  return handlers;
}

function getHandlerTestPath(handlerPath: string): string {
  // Convert: ingestion/ingest-ohlcv.ts -> ingestion/ingest-ohlcv.test.ts
  const relativePath = handlerPath.replace('packages/cli/src/handlers/', '');
  return join(testsDir, relativePath.replace('.ts', '.test.ts'));
}

function checkHandlerForViolations(handlerPath: string): string[] {
  const violations: string[] = [];
  const content = readFileSync(handlerPath, 'utf-8');

  // Check for forbidden patterns
  const forbiddenPatterns = [
    { pattern: /console\.(log|error|warn|info)/, message: 'console.log/error/warn/info' },
    { pattern: /process\.exit/, message: 'process.exit' },
    { pattern: /try\s*\{[\s\S]*?\}\s*catch/, message: 'try/catch (errors should bubble)' },
    {
      pattern: /formatOutput|formatTable|formatJson/,
      message: 'output formatting (should be in executor)',
    },
    { pattern: /new\s+\w+Repository\(/, message: 'direct repository instantiation (use context)' },
    { pattern: /new\s+\w+Service\(/, message: 'direct service instantiation (use context)' },
  ];

  for (const { pattern, message } of forbiddenPatterns) {
    if (pattern.test(content)) {
      violations.push(`  ❌ Uses ${message}`);
    }
  }

  return violations;
}

function checkTestFile(testPath: string, handlerName: string): string[] {
  const issues: string[] = [];

  if (!existsSync(testPath)) {
    return [`  ❌ Missing test file: ${testPath}`];
  }

  const content = readFileSync(testPath, 'utf-8');

  // Check for required test patterns
  const requiredPatterns = [
    {
      pattern: /calls service|service.*called|mockService|mock.*service/i,
      message: 'service call verification',
    },
    { pattern: /parameter|conversion|convert|date|Date/i, message: 'parameter conversion test' },
    { pattern: /error|throw|reject|propagat/i, message: 'error propagation test' },
  ];

  for (const { pattern, message } of requiredPatterns) {
    if (!pattern.test(content)) {
      issues.push(`  ⚠️  Missing ${message} test`);
    }
  }

  // Check for isolation test
  if (
    !content.includes('isolation') &&
    !content.includes('REPL') &&
    !content.includes('plain object')
  ) {
    issues.push(`  ⚠️  Consider adding isolation test (REPL-friendly)`);
  }

  return issues;
}

console.log('🔍 Verifying handler tests...\n');

const handlers = getAllHandlers();
let totalIssues = 0;
const handlerIssues: Array<{ handler: string; issues: string[] }> = [];

for (const handler of handlers) {
  const handlerPath = join(handlersDir, handler);
  const handlerName = basename(handler, '.ts');
  const testPath = getHandlerTestPath(handlerPath);
  const issues: string[] = [];

  // Check handler for violations
  const violations = checkHandlerForViolations(handlerPath);
  if (violations.length > 0) {
    issues.push('Handler violations:');
    issues.push(...violations);
  }

  // Check test file
  const testIssues = checkTestFile(testPath, handlerName);
  issues.push(...testIssues);

  if (issues.length > 0) {
    handlerIssues.push({ handler, issues });
    totalIssues += issues.length;
  }
}

// Report results
if (totalIssues > 0) {
  console.error('❌ Handler test verification found issues:\n');
  for (const { handler, issues } of handlerIssues) {
    console.error(`📁 ${handler}`);
    issues.forEach((issue) => console.error(issue));
    console.error('');
  }
  console.error(`Total issues: ${totalIssues}`);
  process.exit(1);
} else {
  console.log('✅ All handlers have proper tests!\n');
  console.log(`   Verified ${handlers.length} handlers`);
  process.exit(0);
}
