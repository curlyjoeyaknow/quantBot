#!/usr/bin/env tsx

/**
 * Documentation Verification Script
 *
 * Ensures documentation is updated when code changes.
 * Checks for DOCS: comments and verifies referenced documentation exists.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '../..');

interface DocRequirement {
  file: string;
  line: number;
  docPath: string;
  docExists: boolean;
  docUpdated: boolean;
}

/**
 * Get list of changed files
 */
function getChangedFiles(): string[] {
  try {
    execSync('git rev-parse --git-dir', { stdio: 'ignore' });
  } catch {
    return [];
  }

  try {
    const staged = execSync('git diff --cached --name-only', { encoding: 'utf-8', cwd: ROOT })
      .trim()
      .split('\n')
      .filter((f) => f.length > 0);
    if (staged.length > 0) {
      return staged;
    }
    return execSync('git diff --name-only', { encoding: 'utf-8', cwd: ROOT })
      .trim()
      .split('\n')
      .filter((f) => f.length > 0);
  } catch {
    return [];
  }
}

/**
 * Find DOCS: comments in source files
 */
function findDocRequirements(filePath: string): DocRequirement[] {
  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const requirements: DocRequirement[] = [];

    // Pattern: // DOCS: path/to/doc.md
    const docPattern = /\/\/\s*DOCS?:\s*(.+)/i;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(docPattern);
      if (match) {
        const docPath = match[1].trim();
        // Resolve relative to file or root
        let resolvedPath: string;
        if (docPath.startsWith('/')) {
          resolvedPath = join(ROOT, docPath);
        } else if (docPath.startsWith('docs/') || docPath.startsWith('./docs/')) {
          resolvedPath = join(ROOT, docPath.replace(/^\.\//, ''));
        } else {
          // Relative to file
          resolvedPath = join(dirname(filePath), docPath);
        }

        const changedFiles = getChangedFiles();
        const docUpdated = changedFiles.some((f) => {
          const absPath = join(ROOT, f);
          return absPath === resolvedPath || absPath.startsWith(resolvedPath);
        });

        requirements.push({
          file: filePath,
          line: i + 1,
          docPath: resolvedPath,
          docExists: existsSync(resolvedPath),
          docUpdated,
        });
      }
    }

    return requirements;
  } catch {
    return [];
  }
}

/**
 * Detect new features/APIs that might need documentation
 */
function detectNewFeatures(changedFiles: string[]): string[] {
  const newFeatures: string[] = [];

  // Patterns that suggest new features
  const featurePatterns = [
    /^\+.*export\s+(?:async\s+)?function\s+(\w+)/m,
    /^\+.*export\s+(?:const|class|interface|type)\s+(\w+)/m,
    /^\+.*\/\/\s*FEATURE:/i,
    /^\+.*\/\/\s*NEW:/i,
  ];

  for (const file of changedFiles) {
    // Only check source files
    if (!file.includes('/src/') || file.includes('/tests/')) {
      continue;
    }

    try {
      const content = readFileSync(join(ROOT, file), 'utf-8');
      for (const pattern of featurePatterns) {
        const matches = content.matchAll(new RegExp(pattern, 'gm'));
        for (const match of matches) {
          if (match[1]) {
            newFeatures.push(`${file}: ${match[1]}`);
          }
        }
      }
    } catch {
      // Can't read file
    }
  }

  return newFeatures;
}

/**
 * Check if documentation exists for a package
 */
function checkPackageDocumentation(packageName: string): { exists: boolean; paths: string[] } {
  const paths: string[] = [];

  // Check package README
  const packageReadme = join(ROOT, 'packages', packageName, 'README.md');
  if (existsSync(packageReadme)) {
    paths.push(relative(ROOT, packageReadme));
  }

  // Check docs directory
  const docsDir = join(ROOT, 'docs', packageName);
  if (existsSync(docsDir) && statSync(docsDir).isDirectory()) {
    const files = readdirSync(docsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => relative(ROOT, join(docsDir, entry.name)));
    paths.push(...files);
  }

  return {
    exists: paths.length > 0,
    paths,
  };
}

/**
 * Main function
 */
function main(): void {
  console.log('🔍 Verifying documentation...\n');

  const changedFiles = getChangedFiles();

  // If no changes, skip check
  if (changedFiles.length === 0) {
    console.log('ℹ️  No changes detected. Skipping documentation check.\n');
    process.exit(0);
  }

  const allRequirements: DocRequirement[] = [];
  const missingDocs: DocRequirement[] = [];
  const notUpdatedDocs: DocRequirement[] = [];

  // Check for DOCS: comments in changed files
  for (const file of changedFiles) {
    const filePath = join(ROOT, file);
    if (!existsSync(filePath)) {
      continue;
    }

    // Only check source files
    if (!file.includes('/src/') && !file.includes('/scripts/')) {
      continue;
    }

    const requirements = findDocRequirements(filePath);
    allRequirements.push(...requirements);

    for (const req of requirements) {
      if (!req.docExists) {
        missingDocs.push(req);
      } else if (!req.docUpdated) {
        notUpdatedDocs.push(req);
      }
    }
  }

  // Check for new features that might need documentation
  const newFeatures = detectNewFeatures(changedFiles);

  // If no documentation requirements, check passes
  if (allRequirements.length === 0 && newFeatures.length === 0) {
    console.log('✅ No documentation requirements detected.\n');
    process.exit(0);
  }

  // Report missing documentation
  if (missingDocs.length > 0) {
    console.error('❌ Missing documentation files:\n');
    for (const req of missingDocs) {
      console.error(`  ${relative(ROOT, req.file)}:${req.line}`);
      console.error(`    Required: ${relative(ROOT, req.docPath)}`);
      console.error('');
    }
  }

  // Report documentation not updated
  if (notUpdatedDocs.length > 0) {
    console.warn('⚠️  Documentation files referenced but not updated:\n');
    for (const req of notUpdatedDocs) {
      console.warn(`  ${relative(ROOT, req.file)}:${req.line}`);
      console.warn(`    Referenced: ${relative(ROOT, req.docPath)}`);
      console.warn(`    Please update this documentation file in the same PR`);
      console.warn('');
    }
  }

  // Report new features
  if (newFeatures.length > 0) {
    console.warn('⚠️  New features detected that might need documentation:\n');
    for (const feature of newFeatures.slice(0, 10)) {
      // Limit to first 10 to avoid spam
      console.warn(`  - ${feature}`);
    }
    if (newFeatures.length > 10) {
      console.warn(`  ... and ${newFeatures.length - 10} more`);
    }
    console.warn('');
  }

  // Exit with error if missing docs
  if (missingDocs.length > 0) {
    console.error('💡 To fix:');
    console.error('   1. Create the referenced documentation files');
    console.error('   2. Or remove/update DOCS: comments if documentation is not needed');
    console.error('');
    process.exit(1);
  }

  // Exit with warning (but success) if docs not updated or new features
  if (notUpdatedDocs.length > 0 || newFeatures.length > 0) {
    console.warn('💡 Consider updating documentation for these changes\n');
    process.exit(0); // Warning, not error
  }

  console.log('✅ All documentation requirements met!\n');
  process.exit(0);
}

main();
