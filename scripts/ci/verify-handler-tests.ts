#!/usr/bin/env tsx

/**
 * Handler Test Verification Script
 *
 * Ensures every CLI handler has a corresponding test file.
 * Scans packages/cli/src/handlers/ and verifies tests exist in
 * packages/cli/tests/unit/handlers/
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '../..');

interface HandlerInfo {
  handlerPath: string;
  relativePath: string;
  expectedTestPath: string;
  hasTest: boolean;
  testFiles: string[];
}

/**
 * Find all handler files recursively
 */
function findHandlerFiles(dir: string, baseDir: string = dir): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip node_modules, dist, etc.
      if (!['node_modules', 'dist', '.git'].includes(entry.name)) {
        files.push(...findHandlerFiles(fullPath, baseDir));
      }
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Convert handler path to expected test path
 */
function getExpectedTestPath(handlerPath: string): string {
  // Convert: packages/cli/src/handlers/ingestion/ensure-ohlcv-coverage.ts
  // To: packages/cli/tests/unit/handlers/ingestion/ensure-ohlcv-coverage.test.ts
  const relativePath = relative(join(ROOT, 'packages/cli/src/handlers'), handlerPath);
  const testPath = join(ROOT, 'packages/cli/tests/unit/handlers', relativePath.replace(/\.ts$/, '.test.ts'));
  return testPath;
}

/**
 * Find all test files that might test this handler
 */
function findTestFiles(handlerPath: string): string[] {
  const handlerDir = dirname(handlerPath);
  const handlerName = basename(handlerPath, '.ts');
  const testDir = handlerDir.replace('/src/handlers/', '/tests/unit/handlers/');

  const testFiles: string[] = [];

  // Check if test directory exists
  if (!existsSync(testDir)) {
    return testFiles;
  }

  // Look for test files matching the handler name
  const patterns = [
    `${handlerName}.test.ts`,
    `${handlerName}.spec.ts`,
    `${handlerName}-isolation.test.ts`,
    `${handlerName}.regression.test.ts`,
  ];

  try {
    const entries = readdirSync(testDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts'))) {
        // Check if test file imports or references the handler
        const testFilePath = join(testDir, entry.name);
        const testContent = readFileSync(testFilePath, 'utf-8');
        const handlerImportName = handlerName.replace(/-/g, '');
        const handlerFileName = basename(handlerPath);

        // Check if test file imports the handler
        if (
          testContent.includes(handlerFileName) ||
          testContent.includes(handlerImportName) ||
          testContent.includes(handlerName)
        ) {
          testFiles.push(testFilePath);
        }
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return testFiles;
}

/**
 * Check if test file actually tests the handler
 */
function testFileTestsHandler(testFilePath: string, handlerPath: string): boolean {
  try {
    const testContent = readFileSync(testFilePath, 'utf-8');
    const handlerName = basename(handlerPath, '.ts');
    const handlerFileName = basename(handlerPath);

    // Check for imports of the handler
    const importPatterns = [
      new RegExp(`import.*${handlerFileName.replace('.ts', '')}`, 'i'),
      new RegExp(`from.*${handlerFileName.replace('.ts', '')}`, 'i'),
      new RegExp(`import.*${handlerName}`, 'i'),
    ];

    for (const pattern of importPatterns) {
      if (pattern.test(testContent)) {
        return true;
      }
    }

    // Check for describe/it blocks mentioning the handler
    const describePatterns = [
      new RegExp(`describe\\(['"]${handlerName}`, 'i'),
      new RegExp(`describe\\(['"].*${handlerName}`, 'i'),
    ];

    for (const pattern of describePatterns) {
      if (pattern.test(testContent)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Analyze all handlers and their tests
 */
function analyzeHandlers(): HandlerInfo[] {
  const handlersDir = join(ROOT, 'packages/cli/src/handlers');
  if (!existsSync(handlersDir)) {
    console.warn('⚠️  Handlers directory not found:', handlersDir);
    return [];
  }

  const handlerFiles = findHandlerFiles(handlersDir);
  const handlers: HandlerInfo[] = [];

  for (const handlerPath of handlerFiles) {
    const relativePath = relative(ROOT, handlerPath);
    const expectedTestPath = getExpectedTestPath(handlerPath);
    const testFiles = findTestFiles(handlerPath);

    // Check if any test file actually tests this handler
    const validTestFiles = testFiles.filter((testFile) => testFileTestsHandler(testFile, handlerPath));
    const hasTest = validTestFiles.length > 0 || existsSync(expectedTestPath);

    handlers.push({
      handlerPath,
      relativePath,
      expectedTestPath,
      hasTest,
      testFiles: validTestFiles.length > 0 ? validTestFiles : testFiles,
    });
  }

  return handlers;
}

/**
 * Main function
 */
function main(): void {
  console.log('🔍 Verifying handler tests...\n');

  const handlers = analyzeHandlers();
  const missingTests = handlers.filter((h) => !h.hasTest);

  if (missingTests.length === 0) {
    console.log(`✅ All ${handlers.length} handlers have tests!\n`);
    process.exit(0);
  }

  console.error(`❌ Found ${missingTests.length} handler(s) without tests:\n`);

  for (const handler of missingTests) {
    console.error(`  ${handler.relativePath}`);
    console.error(`    Expected test: ${relative(ROOT, handler.expectedTestPath)}`);
    if (handler.testFiles.length > 0) {
      console.error(`    Found test files but they don't test this handler:`);
      for (const testFile of handler.testFiles) {
        console.error(`      - ${relative(ROOT, testFile)}`);
      }
    }
    console.error('');
  }

  console.error('💡 To fix:');
  console.error('   1. Create test file at expected location');
  console.error('   2. Import and test the handler function');
  console.error('   3. Follow pattern: packages/cli/tests/unit/handlers/{package}/{handler-name}.test.ts\n');

  process.exit(1);
}

main();

