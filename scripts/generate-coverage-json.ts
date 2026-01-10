#!/usr/bin/env tsx
/**
 * Generate Coverage JSON Automatically
 *
 * This script:
 * 1. Runs tests with coverage
 * 2. Ensures coverage-summary.json exists
 * 3. Optionally stores and prints coverage snapshot
 *
 * Usage:
 *   tsx scripts/generate-coverage-json.ts
 *   tsx scripts/generate-coverage-json.ts --store
 *   tsx scripts/generate-coverage-json.ts --store --print
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const COVERAGE_DIR = join(ROOT, 'coverage');
const SUMMARY_JSON = join(COVERAGE_DIR, 'coverage-summary.json');

interface CoverageSummary {
  total?: {
    lines?: { pct: number; covered: number; total: number; skipped: number };
    statements?: { pct: number; covered: number; total: number; skipped: number };
    functions?: { pct: number; covered: number; total: number; skipped: number };
    branches?: { pct: number; covered: number; total: number; skipped: number };
  };
}

function runTestsWithCoverage(): void {
  console.log('🧪 Running tests with coverage...');
  try {
    execSync('pnpm test:cov', {
      cwd: ROOT,
      stdio: 'inherit',
    });
  } catch (error) {
    console.error('❌ Test run failed');
    process.exit(1);
  }
}

function ensureCoverageJson(): boolean {
  if (existsSync(SUMMARY_JSON)) {
    console.log(`✅ Coverage JSON found: ${SUMMARY_JSON}`);
    return true;
  }

  console.log('⚠️  Coverage JSON not found, running tests...');
  runTestsWithCoverage();

  if (existsSync(SUMMARY_JSON)) {
    console.log(`✅ Coverage JSON generated: ${SUMMARY_JSON}`);
    return true;
  }

  console.error(`❌ Failed to generate coverage JSON at ${SUMMARY_JSON}`);
  console.error('   Make sure vitest is configured with json-summary reporter');
  return false;
}

function validateCoverageJson(): boolean {
  try {
    const content = readFileSync(SUMMARY_JSON, 'utf-8');
    const json: CoverageSummary = JSON.parse(content);

    if (!json.total) {
      console.error('❌ Invalid coverage JSON: missing "total" field');
      return false;
    }

    const hasMetrics =
      json.total.lines || json.total.statements || json.total.functions || json.total.branches;

    if (!hasMetrics) {
      console.error('❌ Invalid coverage JSON: no coverage metrics found');
      return false;
    }

    return true;
  } catch (error) {
    console.error('❌ Failed to parse coverage JSON:', error);
    return false;
  }
}

function storeAndPrint(): void {
  const storeScript = join(ROOT, 'scripts', 'coverage-store-and-print.sh');
  if (!existsSync(storeScript)) {
    console.warn('⚠️  Store script not found, skipping storage');
    return;
  }

  try {
    execSync(`bash ${storeScript} ${SUMMARY_JSON}`, {
      cwd: ROOT,
      stdio: 'inherit',
    });
  } catch (error) {
    console.warn('⚠️  Failed to store coverage snapshot:', error);
  }
}

function printSummary(): void {
  try {
    const content = readFileSync(SUMMARY_JSON, 'utf-8');
    const json: CoverageSummary = JSON.parse(content);

    const totals = json.total;
    if (!totals) {
      return;
    }

    const lines = totals.lines;
    const statements = totals.statements;
    const functions = totals.functions;
    const branches = totals.branches;

    console.log('\n📊 Coverage Summary:');
    if (lines) {
      console.log(`   Lines:      ${lines.pct.toFixed(2)}% (${lines.covered}/${lines.total})`);
    }
    if (statements) {
      console.log(
        `   Statements: ${statements.pct.toFixed(2)}% (${statements.covered}/${statements.total})`
      );
    }
    if (functions) {
      console.log(
        `   Functions:  ${functions.pct.toFixed(2)}% (${functions.covered}/${functions.total})`
      );
    }
    if (branches) {
      console.log(
        `   Branches:   ${branches.pct.toFixed(2)}% (${branches.covered}/${branches.total})`
      );
    }
    console.log('');
  } catch (error) {
    console.warn('⚠️  Failed to print summary:', error);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const shouldStore = args.includes('--store');
  const shouldPrint = args.includes('--print') || shouldStore;

  // Ensure coverage JSON exists
  if (!ensureCoverageJson()) {
    process.exit(1);
  }

  // Validate JSON
  if (!validateCoverageJson()) {
    process.exit(1);
  }

  // Print summary if requested
  if (shouldPrint) {
    printSummary();
  }

  // Store if requested
  if (shouldStore) {
    storeAndPrint();
  }

  console.log(`✅ Coverage JSON ready: ${SUMMARY_JSON}`);
}

main();
