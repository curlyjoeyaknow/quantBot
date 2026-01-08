#!/usr/bin/env node

/**
 * Generate coverage JSON and copy to public directory for the viewer
 * This runs before the dev server starts
 */

import { execSync } from 'child_process';
import { existsSync, copyFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const COVERAGE_VIEWER_ROOT = join(__dirname, '..');
const ROOT = join(COVERAGE_VIEWER_ROOT, '..');
const COVERAGE_DIR = join(ROOT, 'coverage');
const SUMMARY_JSON = join(COVERAGE_DIR, 'coverage-summary.json');
const PUBLIC_DIR = join(COVERAGE_VIEWER_ROOT, 'public');
const PUBLIC_COVERAGE_JSON = join(PUBLIC_DIR, 'coverage-summary.json');

function generateCoverage() {
  console.log('📊 Generating coverage JSON...');
  try {
    // Use the existing script from the root
    execSync('tsx scripts/generate-coverage-json.ts', {
      cwd: ROOT,
      stdio: 'inherit',
    });
  } catch (error) {
    console.warn('⚠️  Coverage generation failed, continuing anyway...');
    console.warn('   You can manually run: pnpm test:cov');
    return false;
  }
  return true;
}

function copyCoverageToPublic() {
  if (!existsSync(SUMMARY_JSON)) {
    console.warn(`⚠️  Coverage JSON not found: ${SUMMARY_JSON}`);
    console.warn('   Run: pnpm test:cov from the root directory');
    return false;
  }

  // Ensure public directory exists
  if (!existsSync(PUBLIC_DIR)) {
    mkdirSync(PUBLIC_DIR, { recursive: true });
  }

  // Copy coverage file to public directory
  try {
    copyFileSync(SUMMARY_JSON, PUBLIC_COVERAGE_JSON);
    console.log(`✅ Coverage JSON copied to: ${PUBLIC_COVERAGE_JSON}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to copy coverage JSON:', error.message);
    return false;
  }
}

function main() {
  // Try to generate coverage if it doesn't exist
  if (!existsSync(SUMMARY_JSON)) {
    generateCoverage();
  }

  // Copy to public directory
  copyCoverageToPublic();
}

main();

