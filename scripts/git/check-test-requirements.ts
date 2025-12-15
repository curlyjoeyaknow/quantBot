#!/usr/bin/env ts-node
/**
 * Analyzes git changes and enforces appropriate test requirements
 * based on change type and development stage
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface ChangeAnalysis {
  file: string;
  type: ChangeType;
  stage: DevelopmentStage;
  hasTests: boolean;
  requiredTests: TestRequirement[];
  missingTests: TestRequirement[];
}

type ChangeType =
  | 'financial-calculation'
  | 'parser'
  | 'database'
  | 'api-endpoint'
  | 'mint-handling'
  | 'async-operation'
  | 'retry-logic'
  | 'bugfix'
  | 'other';

type DevelopmentStage = 'early' | 'mid' | 'late' | 'production';

type TestRequirement =
  | 'unit'
  | 'property'
  | 'integration'
  | 'fuzzing'
  | 'regression'
  | 'concurrency';

// Patterns to detect change types
const PATTERNS = {
  'financial-calculation': [
    /calculatePnL|calculateFee|calculateSlippage|calculateProfit|calculateLoss/i,
    /slippage|pnl|profit|loss|fee|price.*calculation/i,
  ],
  parser: [
    /parse|extract|decode|deserialize|parseAddress|parseTransaction/i,
    /extractMints|parseTelegram|parseHTML/i,
  ],
  database: [
    /insert|update|delete|query|repository|database|db\./i,
    /storage|persist|save.*to.*db/i,
  ],
  'api-endpoint': [
    /route|endpoint|controller|handler|\.post\(|\.get\(|\.put\(|\.delete\(/i,
    /\/api\//i,
  ],
  'mint-handling': [
    /mint.*address|mintAddress|mint_address|handleMint|processMint/i,
    /substring.*mint|toLowerCase.*mint|toUpperCase.*mint/i,
  ],
  'async-operation': [
    /async|await|Promise|\.then\(|setTimeout|setInterval/i,
    /concurrent|parallel|race/i,
  ],
  'retry-logic': [/retry|backoff|exponential.*retry|retry.*logic/i],
  bugfix: [/fix|bug|issue|#\d+|FIX|BUG/i],
};

// Test requirements by change type
const TEST_REQUIREMENTS: Record<ChangeType, TestRequirement[]> = {
  'financial-calculation': ['unit', 'property'],
  parser: ['unit', 'fuzzing'],
  database: ['integration'],
  'api-endpoint': ['integration', 'unit'],
  'mint-handling': ['unit', 'property'],
  'async-operation': ['unit', 'concurrency'],
  'retry-logic': ['unit', 'integration'],
  bugfix: ['regression', 'unit'],
  other: ['unit'],
};

// Development stage detection (based on file location and structure)
function detectStage(file: string): DevelopmentStage {
  if (file.includes('/tests/e2e/') || file.includes('/tests/load/')) {
    return 'production';
  }
  if (file.includes('/tests/integration/')) {
    return 'late';
  }
  if (file.includes('/tests/properties/') || file.includes('/tests/fuzzing/')) {
    return 'late';
  }
  if (file.includes('/tests/unit/')) {
    return 'mid';
  }
  if (file.includes('/src/') && !file.includes('/tests/')) {
    // Check if it's a new file (early stage) or existing (mid/late)
    return 'mid';
  }
  return 'early';
}

// Analyze a single file change
function analyzeFile(file: string, diff: string): ChangeAnalysis {
  const types: ChangeType[] = [];

  // Detect change types
  for (const [type, patterns] of Object.entries(PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(diff) || pattern.test(file))) {
      types.push(type as ChangeType);
    }
  }

  // Default to 'other' if no specific type detected
  const changeType = types[0] || 'other';
  const stage = detectStage(file);

  // Find test file
  const testFile = findTestFile(file);
  const hasTests = testFile && existsSync(testFile);

  // Get required tests
  const requiredTests = TEST_REQUIREMENTS[changeType] || ['unit'];

  // Check which tests exist
  const missingTests: TestRequirement[] = [];
  if (hasTests && testFile) {
    const testContent = readFileSync(testFile, 'utf-8');
    for (const requirement of requiredTests) {
      if (!hasTestType(testContent, requirement)) {
        missingTests.push(requirement);
      }
    }
  } else {
    missingTests.push(...requiredTests);
  }

  return {
    file,
    type: changeType,
    stage,
    hasTests,
    requiredTests,
    missingTests,
  };
}

// Find corresponding test file
function findTestFile(sourceFile: string): string | null {
  // Remove .ts extension and find test file
  const base = sourceFile.replace(/\.ts$/, '');

  // Try different test file locations
  const candidates = [
    base.replace('/src/', '/tests/unit/') + '.test.ts',
    base.replace('/src/', '/tests/') + '.test.ts',
    base + '.test.ts',
    base.replace('/src/', '/tests/integration/') + '.integration.ts',
    base.replace('/src/', '/tests/properties/') + '.property.ts',
    base.replace('/src/', '/tests/fuzzing/') + '.fuzz.ts',
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

// Check if test file has specific test type
function hasTestType(testContent: string, type: TestRequirement): boolean {
  const patterns: Record<TestRequirement, RegExp[]> = {
    unit: [/describe\(|it\(|test\(/i],
    property: [/fc\.assert|fc\.property|property.*test/i],
    integration: [/integration|beforeAll|afterAll|setupTestDatabase/i],
    fuzzing: [/fuzzing|fc\.anything|malformed|garbage.*input/i],
    regression: [/regression|reproduces.*bug|bugfix|BUG-\d+/i],
    concurrency: [/concurrent|Promise\.all|race.*condition|parallel/i],
  };

  return patterns[type]?.some((pattern) => pattern.test(testContent)) || false;
}

// Get git diff for staged files
function getStagedChanges(): Array<{ file: string; diff: string }> {
  try {
    const files = execSync('git diff --cached --name-only', { encoding: 'utf-8' })
      .trim()
      .split('\n')
      .filter(Boolean);

    return files.map((file) => {
      try {
        const diff = execSync(`git diff --cached ${file}`, { encoding: 'utf-8' });
        return { file, diff };
      } catch {
        return { file, diff: '' };
      }
    });
  } catch {
    return [];
  }
}

// Main function
function main() {
  console.log('🔍 Analyzing changes for test requirements...\n');

  const changes = getStagedChanges();

  if (changes.length === 0) {
    console.log('✅ No staged changes to analyze');
    return 0;
  }

  const analyses: ChangeAnalysis[] = [];
  let hasErrors = false;

  for (const { file, diff } of changes) {
    // Skip test files themselves, config files, etc.
    if (
      file.includes('.test.ts') ||
      file.includes('.spec.ts') ||
      file.includes('.config.') ||
      file.includes('package.json') ||
      file.includes('tsconfig.json') ||
      file.includes('.md') ||
      file.includes('.mdc')
    ) {
      continue;
    }

    // Only analyze source files
    if (!file.includes('/src/') && !file.includes('/scripts/')) {
      continue;
    }

    const analysis = analyzeFile(file, diff);
    analyses.push(analysis);

    if (analysis.missingTests.length > 0) {
      hasErrors = true;
      console.log(`❌ ${analysis.file}`);
      console.log(`   Type: ${analysis.type}`);
      console.log(`   Stage: ${analysis.stage}`);
      console.log(`   Missing tests: ${analysis.missingTests.join(', ')}`);

      if (!analysis.hasTests) {
        console.log(
          `   ⚠️  No test file found. Expected: ${findTestFile(analysis.file) || 'tests/**/*.test.ts'}`
        );
      }
      console.log('');
    }
  }

  if (hasErrors) {
    console.log('\n❌ Test requirements not met. Please add the required tests before committing.');
    console.log('\nTest requirements by change type:');
    console.log('  - financial-calculation: unit + property tests');
    console.log('  - parser: unit + fuzzing tests');
    console.log('  - database: integration tests');
    console.log('  - api-endpoint: integration + unit tests');
    console.log('  - mint-handling: unit + property tests');
    console.log('  - async-operation: unit + concurrency tests');
    console.log('  - retry-logic: unit + integration tests');
    console.log('  - bugfix: regression + unit tests');
    console.log('  - other: unit tests');
    return 1;
  }

  if (analyses.length > 0) {
    console.log('✅ All test requirements met!\n');
    analyses.forEach((a) => {
      console.log(`   ✓ ${a.file} (${a.type}) - has ${a.requiredTests.join(', ')} tests`);
    });
  }

  return 0;
}

if (require.main === module) {
  process.exit(main());
}

export { analyzeFile, detectStage, TEST_REQUIREMENTS };
