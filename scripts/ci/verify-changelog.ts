#!/usr/bin/env tsx

/**
 * CHANGELOG Verification Script
 *
 * Ensures CHANGELOG.md is updated for functional changes.
 * Analyzes git diff and validates changelog entries.
 */

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..', '..');
const ROOT = __dirname;

interface ChangeInfo {
  file: string;
  type: 'feature' | 'bugfix' | 'breaking' | 'security' | 'performance' | 'other';
  requiresChangelog: boolean;
}

/**
 * Get git diff for staged or changed files
 */
function getGitDiff(): string {
  try {
    // Check if we're in a git repository
    execSync('git rev-parse --git-dir', { stdio: 'ignore' });
  } catch {
    // Not a git repository, return empty diff
    return '';
  }

  try {
    // Try staged changes first (for pre-commit)
    return execSync('git diff --cached', { encoding: 'utf-8', cwd: ROOT });
  } catch {
    try {
      // Fall back to unstaged changes
      return execSync('git diff', { encoding: 'utf-8', cwd: ROOT });
    } catch {
      // No changes or error
      return '';
    }
  }
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
 * Analyze changes to determine if changelog is required
 */
function analyzeChanges(changedFiles: string[], diff: string): ChangeInfo[] {
  const changes: ChangeInfo[] = [];

  // Patterns to detect change types
  const featurePatterns = [
    /^\+.*export\s+(?:async\s+)?function\s+\w+/m, // New exported functions
    /^\+.*export\s+(?:const|class|interface|type)\s+\w+/m, // New exports
    /^\+.*\/\/\s*FEATURE:/i, // Feature comments
  ];

  const bugfixPatterns = [
    /fix|bug|issue|FIX|BUG|ISSUE/i,
    /^\+.*\/\/\s*FIX:/i,
    /^\+.*\/\/\s*BUGFIX:/i,
  ];

  const breakingPatterns = [
    /BREAKING|breaking|deprecated|DEPRECATED/i,
    /^\+.*\/\/\s*BREAKING:/i,
    /^\+.*\/\/\s*DEPRECATED:/i,
  ];

  const securityPatterns = [
    /security|SECURITY|vulnerability|VULNERABILITY|CVE/i,
    /^\+.*\/\/\s*SECURITY:/i,
  ];

  const performancePatterns = [
    /performance|PERFORMANCE|optimize|OPTIMIZE|speed|SPEED/i,
    /^\+.*\/\/\s*PERFORMANCE:/i,
  ];

  // Skip test files, config files, and documentation-only changes
  const skipPatterns = [
    /\.test\.ts$/,
    /\.spec\.ts$/,
    /\.fuzz\.ts$/,
    /\.property\.ts$/,
    /\.config\./,
    /tsconfig\.json$/,
    /package\.json$/,
    /pnpm-lock\.yaml$/,
    /\.md$/,
    /CHANGELOG\.md$/,
  ];

  for (const file of changedFiles) {
    // Skip if file matches skip patterns
    if (skipPatterns.some((pattern) => pattern.test(file))) {
      continue;
    }

    // Only check source files
    if (!file.includes('/src/') && !file.includes('/scripts/')) {
      continue;
    }

    let type: ChangeInfo['type'] = 'other';
    let requiresChangelog = false;

    // Check diff for this file
    const fileDiff = diff.split(`diff --git`).find((chunk) => chunk.includes(file)) || '';

    // Detect change type
    if (breakingPatterns.some((pattern) => pattern.test(fileDiff))) {
      type = 'breaking';
      requiresChangelog = true;
    } else if (securityPatterns.some((pattern) => pattern.test(fileDiff))) {
      type = 'security';
      requiresChangelog = true;
    } else if (bugfixPatterns.some((pattern) => pattern.test(fileDiff))) {
      type = 'bugfix';
      requiresChangelog = true;
    } else if (featurePatterns.some((pattern) => pattern.test(fileDiff))) {
      type = 'feature';
      requiresChangelog = true;
    } else if (performancePatterns.some((pattern) => pattern.test(fileDiff))) {
      type = 'performance';
      requiresChangelog = true;
    } else if (fileDiff.includes('+') && fileDiff.includes('-')) {
      // Has actual code changes (not just whitespace)
      const addedLines = fileDiff.match(/^\+[^+]/gm) || [];
      const removedLines = fileDiff.match(/^-[^-]/gm) || [];
      if (addedLines.length > 0 || removedLines.length > 0) {
        requiresChangelog = true;
      }
    }

    if (requiresChangelog) {
      changes.push({
        file,
        type,
        requiresChangelog: true,
      });
    }
  }

  return changes;
}

/**
 * Read and parse CHANGELOG.md
 */
function readChangelog(): { hasUnreleased: boolean; entries: string[] } {
  const changelogPath = join(ROOT, 'CHANGELOG.md');
  if (!existsSync(changelogPath)) {
    return { hasUnreleased: false, entries: [] };
  }

  const content = readFileSync(changelogPath, 'utf-8');
  const lines = content.split('\n');

  let inUnreleased = false;
  const entries: string[] = [];
  let currentEntry = '';

  for (const line of lines) {
    if (line.match(/^##\s*\[Unreleased\]/i)) {
      inUnreleased = true;
      continue;
    }

    if (inUnreleased) {
      // Check if we hit the next version section
      if (line.match(/^##\s*\[/)) {
        break;
      }

      // Collect entries
      if (line.match(/^\s*[-*]\s+/)) {
        if (currentEntry) {
          entries.push(currentEntry.trim());
        }
        currentEntry = line;
      } else if (currentEntry && line.trim()) {
        currentEntry += ' ' + line.trim();
      }
    }
  }

  if (currentEntry) {
    entries.push(currentEntry.trim());
  }

  return {
    hasUnreleased: inUnreleased || content.includes('[Unreleased]'),
    entries,
  };
}

/**
 * Validate changelog format
 */
function validateChangelogFormat(): { valid: boolean; errors: string[] } {
  const changelogPath = join(ROOT, 'CHANGELOG.md');
  if (!existsSync(changelogPath)) {
    return { valid: false, errors: ['CHANGELOG.md not found'] };
  }

  const content = readFileSync(changelogPath, 'utf-8');
  const errors: string[] = [];

  // Check for [Unreleased] section
  if (!content.includes('[Unreleased]') && !content.includes('## [Unreleased]')) {
    errors.push('CHANGELOG.md must have an [Unreleased] section');
  }

  // Check for valid sections
  const validSections = ['Security', 'Fixed', 'Added', 'Changed', 'Deprecated', 'Removed'];
  const sections = content.match(/^###\s+(\w+)/gm) || [];
  for (const section of sections) {
    const sectionName = section.replace(/^###\s+/, '');
    if (!validSections.includes(sectionName)) {
      errors.push(`Invalid section: ${sectionName}. Must be one of: ${validSections.join(', ')}`);
    }
  }

  // Check for severity indicators in Security/Fixed sections
  const securityFixedContent = content.match(/###\s+(Security|Fixed)[\s\S]*?(?=###|$)/gi) || [];
  for (const section of securityFixedContent) {
    const entries = section.match(/^\s*[-*]\s+(.+)$/gm) || [];
    for (const entry of entries) {
      const entryText = entry.replace(/^\s*[-*]\s+/, '');
      if (!entryText.match(/\*\*(CRITICAL|HIGH|MEDIUM)\*\*/i)) {
        errors.push(
          `Security/Fixed entries must include severity: **CRITICAL**, **HIGH**, or **MEDIUM**`
        );
        break; // Only report once per section
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Main function
 */
function main(): void {
  console.log('🔍 Verifying CHANGELOG.md...\n');

  const changedFiles = getChangedFiles();
  const diff = getGitDiff();

  // If no changes, skip check
  if (changedFiles.length === 0) {
    console.log('ℹ️  No changes detected. Skipping CHANGELOG check.\n');
    process.exit(0);
  }

  // Analyze changes
  const changes = analyzeChanges(changedFiles, diff);
  const requiresChangelog = changes.filter((c) => c.requiresChangelog);

  // If no functional changes, skip check
  if (requiresChangelog.length === 0) {
    console.log('✅ No functional changes detected. CHANGELOG check passed.\n');
    process.exit(0);
  }

  // Read changelog
  const changelog = readChangelog();

  // Validate format
  const formatValidation = validateChangelogFormat();
  if (!formatValidation.valid) {
    console.error('❌ CHANGELOG.md format errors:\n');
    for (const error of formatValidation.errors) {
      console.error(`  - ${error}`);
    }
    console.error('');
    process.exit(1);
  }

  // Check if changelog has [Unreleased] section
  if (!changelog.hasUnreleased) {
    console.error('❌ CHANGELOG.md missing [Unreleased] section\n');
    console.error('💡 Add an [Unreleased] section at the top of CHANGELOG.md\n');
    process.exit(1);
  }

  // Check if changelog has entries
  if (changelog.entries.length === 0) {
    console.error('❌ CHANGELOG.md [Unreleased] section has no entries\n');
    console.error('💡 Add entries for the following changes:\n');
    for (const change of requiresChangelog) {
      console.error(`  - ${change.file} (${change.type})`);
    }
    console.error('');
    process.exit(1);
  }

  console.log(
    `✅ CHANGELOG.md has [Unreleased] section with ${changelog.entries.length} entry/entries\n`
  );
  console.log('📝 Changes requiring changelog:');
  for (const change of requiresChangelog) {
    console.log(`  - ${change.file} (${change.type})`);
  }
  console.log('');

  process.exit(0);
}

main();
