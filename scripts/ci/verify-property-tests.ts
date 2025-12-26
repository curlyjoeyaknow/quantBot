#!/usr/bin/env tsx

/**
 * Property Test Verification Script
 *
 * Ensures financial calculations have property tests.
 * Scans for functions matching financial patterns and verifies property tests exist.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '../..');

interface FinancialFunction {
  file: string;
  functionName: string;
  line: number;
  relativePath: string;
  hasPropertyTest: boolean;
  propertyTestPath?: string;
}

/**
 * Financial calculation patterns to detect
 */
const FINANCIAL_PATTERNS = [
  /calculatePnL|calculateFee|calculateSlippage|calculateProfit|calculateLoss/i,
  /calculate.*[Pp]rice|calculate.*[Cc]ost|calculate.*[Rr]evenue/i,
  /slippage|pnl|profit|loss|fee.*calculation/i,
  /computePnL|computeFee|computeSlippage|computeProfit|computeLoss/i,
  /getPnL|getFee|getSlippage|getProfit|getLoss/i,
  /estimatePnL|estimateFee|estimateSlippage|estimateProfit|estimateLoss/i,
  /calculate.*[Rr]eturn|calculate.*[Rr]oi|calculate.*[Yy]ield/i,
  /calculate.*[Bb]alance|calculate.*[Aa]mount/i,
];

/**
 * Function name patterns that indicate financial calculations
 * Must start with calculate/compute/get/estimate and contain financial terms
 */
const FUNCTION_NAME_PATTERNS = [
  /^(calculate|compute|get|estimate)(PnL|Fee|Slippage|Profit|Loss|Price|Cost|Revenue|Return|Roi|Yield|Balance|Amount)/i,
  /^(calculate|compute|get|estimate)(.*[Pp]rice|.*[Cc]ost|.*[Rr]evenue|.*[Rr]eturn|.*[Rr]oi)/i,
];

/**
 * Common non-financial function names to exclude
 */
const EXCLUDED_NAMES = [
  'if',
  'map',
  'filter',
  'reduce',
  'forEach',
  'find',
  'some',
  'every',
  'async',
  'parse',
  'stringify',
  'format',
  'toString',
  'toISOString',
  'get',
  'set',
  'has',
  'delete',
  'clear',
  'keys',
  'values',
  'entries',
  'then',
  'catch',
  'finally',
  'resolve',
  'reject',
  'all',
  'race',
  'log',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
];

/**
 * Find all source files recursively
 */
function findSourceFiles(
  dir: string,
  excludeDirs: string[] = ['node_modules', 'dist', '.git', 'tests']
): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory() && !excludeDirs.includes(entry.name)) {
      files.push(...findSourceFiles(fullPath, excludeDirs));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.spec.ts')
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Extract function definitions from source code
 */
function extractFunctions(filePath: string): Array<{ name: string; line: number }> {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const functions: Array<{ name: string; line: number }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Match function declarations: function name(...) or export function name(...)
      const functionMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/);
      if (functionMatch) {
        const functionName = functionMatch[1];
        functions.push({ name: functionName, line: lineNum });
        continue;
      }

      // Match arrow functions: const name = (...) => or export const name = (...) =>
      const arrowMatch = line.match(/(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/);
      if (arrowMatch) {
        const functionName = arrowMatch[1];
        functions.push({ name: functionName, line: lineNum });
        continue;
      }

      // Skip method definitions - they're too noisy and not reliable
      // Only match explicit function declarations and arrow function assignments
    }

    return functions;
  } catch {
    return [];
  }
}

/**
 * Check if function matches financial calculation patterns
 */
function isFinancialCalculation(
  functionName: string,
  fileContent: string,
  lineNum: number
): boolean {
  // Check function name patterns
  for (const pattern of FUNCTION_NAME_PATTERNS) {
    if (pattern.test(functionName)) {
      return true;
    }
  }

  // Check content around the function for financial patterns
  const lines = fileContent.split('\n');
  const startLine = Math.max(0, lineNum - 5);
  const endLine = Math.min(lines.length, lineNum + 20);
  const context = lines.slice(startLine, endLine).join('\n');

  for (const pattern of FINANCIAL_PATTERNS) {
    if (pattern.test(context)) {
      return true;
    }
  }

  return false;
}

/**
 * Find property test file for a function
 */
function findPropertyTest(filePath: string, functionName: string): string | undefined {
  const packageDir = filePath.split('/packages/')[1]?.split('/')[0];
  if (!packageDir) {
    return undefined;
  }

  const propertiesTestDir = join(ROOT, 'packages', packageDir, 'tests', 'properties');
  if (!existsSync(propertiesTestDir)) {
    return undefined;
  }

  // Look for test files that might test this function
  try {
    const testFiles = readdirSync(propertiesTestDir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() && (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts'))
      )
      .map((entry) => join(propertiesTestDir, entry.name));

    for (const testFile of testFiles) {
      const testContent = readFileSync(testFile, 'utf-8');
      // Check if test file mentions the function
      if (
        testContent.includes(functionName) ||
        testContent.includes(basename(filePath, '.ts')) ||
        testContent.match(new RegExp(`describe.*${functionName}`, 'i')) ||
        testContent.match(new RegExp(`it.*${functionName}`, 'i'))
      ) {
        return testFile;
      }
    }
  } catch {
    // Can't read directory
  }

  return undefined;
}

/**
 * Analyze all packages for financial calculations
 */
function analyzeFinancialCalculations(): FinancialFunction[] {
  const packagesDir = join(ROOT, 'packages');
  if (!existsSync(packagesDir)) {
    return [];
  }

  const packages = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const financialFunctions: FinancialFunction[] = [];

  for (const pkg of packages) {
    const srcDir = join(packagesDir, pkg, 'src');
    if (!existsSync(srcDir)) {
      continue;
    }

    const sourceFiles = findSourceFiles(srcDir);

    for (const filePath of sourceFiles) {
      const functions = extractFunctions(filePath);
      const fileContent = readFileSync(filePath, 'utf-8');

      for (const func of functions) {
        if (isFinancialCalculation(func.name, fileContent, func.line)) {
          const relativePath = relative(ROOT, filePath);
          const propertyTestPath = findPropertyTest(filePath, func.name);

          financialFunctions.push({
            file: filePath,
            functionName: func.name,
            line: func.line,
            relativePath,
            hasPropertyTest: propertyTestPath !== undefined,
            propertyTestPath,
          });
        }
      }
    }
  }

  return financialFunctions;
}

/**
 * Main function
 */
function main(): void {
  console.log('🔍 Verifying property tests for financial calculations...\n');

  const financialFunctions = analyzeFinancialCalculations();
  const missingTests = financialFunctions.filter((f) => !f.hasPropertyTest);

  if (financialFunctions.length === 0) {
    console.log('ℹ️  No financial calculation functions found.\n');
    process.exit(0);
  }

  if (missingTests.length === 0) {
    console.log(
      `✅ All ${financialFunctions.length} financial calculation(s) have property tests!\n`
    );
    process.exit(0);
  }

  console.error(
    `❌ Found ${missingTests.length} financial calculation(s) without property tests:\n`
  );

  for (const func of missingTests) {
    console.error(`  ${func.relativePath}:${func.line}`);
    console.error(`    Function: ${func.functionName}`);
    console.error(
      `    Expected: packages/${func.relativePath.split('/packages/')[1]?.split('/')[0]}/tests/properties/**/*.test.ts`
    );
    console.error('');
  }

  console.error('💡 To fix:');
  console.error('   1. Create property test file in tests/properties/ directory');
  console.error('   2. Test financial invariants (monotonicity, bounds, conservation laws)');
  console.error('   3. Use fast-check for property-based testing');
  console.error(
    '   4. Follow pattern: packages/{package}/tests/properties/{function-name}.test.ts\n'
  );

  process.exit(1);
}

main();
