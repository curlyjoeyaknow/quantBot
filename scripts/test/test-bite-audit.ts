#!/usr/bin/env tsx
/**
 * Test Bite Audit
 * ================
 *
 * Deliberately introduces bugs in core functions to verify tests catch them.
 *
 * If a bug doesn't break tests, that's where you tighten assertions.
 *
 * Usage:
 *   npm run test:bite-audit
 *
 * This script:
 * 1. Introduces a bug in each core function
 * 2. Runs tests
 * 3. Reports which bugs were caught and which weren't
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';

interface BugTest {
  name: string;
  file: string;
  functionName: string;
  bug: string;
  expectedToFail: boolean;
  caught: boolean;
  testFile?: string; // Specific test file to run
}

const bugs: BugTest[] = [
  {
    name: 'Golden fixtures - wrong PnL calculation',
    file: 'packages/simulation/tests/fixtures/golden-candles.ts',
    functionName: 'expectedNetMultiple',
    bug: 'Flip fee calculation (multiply instead of divide)',
    expectedToFail: true,
    caught: false,
    testFile: 'packages/simulation/tests/golden-fixtures.test.ts',
  },
  {
    name: 'Fee calculation - wrong sign',
    file: 'packages/simulation/src/execution/fees.ts',
    functionName: 'calculateNetPnl',
    bug: 'Add borrowCost instead of subtract',
    expectedToFail: true,
    caught: false,
    testFile: 'packages/simulation/tests/properties/fees.property.test.ts',
  },
  {
    name: 'Boundary test - off-by-one timestamp',
    file: 'packages/simulation/tests/boundaries/timestamp-windows.test.ts',
    functionName: 'should include boundary candles',
    bug: 'Change >= to > (excludes boundary)',
    expectedToFail: true,
    caught: false,
    testFile: 'packages/simulation/tests/boundaries/timestamp-windows.test.ts',
  },
];

function backupFile(filePath: string): string {
  const backupPath = filePath + '.bite-audit-backup';
  copyFileSync(filePath, backupPath);
  return backupPath;
}

function restoreFile(filePath: string, backupPath: string): void {
  copyFileSync(backupPath, filePath);
}

function introduceBug(filePath: string, bug: BugTest): boolean {
  const content = readFileSync(filePath, 'utf-8');
  let modified = content;

  switch (bug.name) {
    case 'Golden fixtures - wrong PnL calculation':
      // Flip the fee calculation formula
      modified = content.replace(
        /return \(exitPrice \* \(1 - feeExitDecimal\)\) \/ \(entryPrice \* \(1 \+ feeEntryDecimal\)\);/g,
        'return (exitPrice * (1 + feeExitDecimal)) * (entryPrice * (1 + feeEntryDecimal));' // ❌ Bug: multiply instead of divide
      );
      break;

    case 'Fee calculation - wrong sign':
      // Add borrowCost instead of subtract
      modified = content.replace(
        /return grossPnl - borrowCost;/g,
        'return grossPnl + borrowCost;' // ❌ Bug: adds cost instead of subtracting
      );
      break;

    case 'Boundary test - off-by-one timestamp':
      // Change >= to > in test assertion
      modified = content.replace(
        /c\.timestamp >= startTimestamp && c\.timestamp <= endTimestamp/g,
        'c.timestamp > startTimestamp && c.timestamp < endTimestamp' // ❌ Bug: excludes boundaries
      );
      break;
  }

  if (modified === content) {
    console.warn(`⚠️  Could not introduce bug in ${bug.name} - pattern not found`);
    return false;
  }

  writeFileSync(filePath, modified, 'utf-8');
  console.log(`🐛 Introduced bug: ${bug.name}`);
  return true;
}

function runTests(testFile?: string): boolean {
  try {
    const testCmd = testFile ? `npm test -- ${testFile} --run` : 'npm test -- --run';
    execSync(testCmd, { stdio: 'pipe' });
    return true; // Tests passed (bug NOT caught)
  } catch (error) {
    return false; // Tests failed (bug CAUGHT)
  }
}

async function main() {
  console.log('🔍 Test Bite Audit\n');
  console.log('This will introduce bugs and verify tests catch them.\n');

  const results: BugTest[] = [];
  const backups: Map<string, string> = new Map();

  for (const bug of bugs) {
    const filePath = join(process.cwd(), bug.file);

    try {
      // Backup original file
      const backupPath = backupFile(filePath);
      backups.set(filePath, backupPath);

      // Introduce bug
      const bugIntroduced = introduceBug(filePath, bug);
      if (!bugIntroduced) {
        console.log(`⏭️  Skipping ${bug.name} - could not introduce bug`);
        continue;
      }

      // Run tests
      console.log(`\n🧪 Testing: ${bug.name}`);
      const testsPassed = runTests(bug.testFile);
      bug.caught = !testsPassed;

      results.push(bug);

      if (bug.caught) {
        console.log(`✅ Bug CAUGHT by tests (expected)`);
      } else {
        console.log(`❌ Bug NOT CAUGHT by tests (tests need tightening!)`);
      }
    } catch (error: any) {
      console.error(`❌ Error testing ${bug.name}:`, error.message);
      bug.caught = false;
      results.push(bug);
    } finally {
      // Restore original file
      const backupPath = backups.get(filePath);
      if (backupPath) {
        restoreFile(filePath, backupPath);
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Bite Audit Summary\n');

  const caught = results.filter((r) => r.caught).length;
  const missed = results.filter((r) => !r.caught).length;

  console.log(`Total bugs tested: ${results.length}`);
  console.log(`Bugs caught: ${caught} ✅`);
  console.log(`Bugs missed: ${missed} ❌\n`);

  if (missed > 0) {
    console.log('⚠️  TESTS NEED TIGHTENING:\n');
    results
      .filter((r) => !r.caught)
      .forEach((r) => {
        console.log(`  - ${r.name}`);
        console.log(`    File: ${r.file}`);
        console.log(`    Function: ${r.functionName}`);
        console.log(`    Bug: ${r.bug}\n`);
      });
  } else {
    console.log('✅ All bugs were caught! Tests are biting.\n');
  }

  // Cleanup backups
  for (const [filePath, backupPath] of backups) {
    try {
      require('fs').unlinkSync(backupPath);
    } catch (error) {
      // Ignore cleanup errors
    }
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
