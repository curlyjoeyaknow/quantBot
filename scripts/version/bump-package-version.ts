#!/usr/bin/env tsx
/**
 * Bump Package Version
 * 
 * Helper script to bump package versions following semver.
 * Updates package.json and optionally updates CHANGELOG.md.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { DateTime } from 'luxon';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '../..');
const CHANGELOG_PATH = join(ROOT_DIR, 'CHANGELOG.md');

type VersionBump = 'patch' | 'minor' | 'major';

/**
 * Parse semver version
 */
function parseVersion(version: string): { major: number; minor: number; patch: number } | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-.*)?$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

/**
 * Bump version according to semver
 */
function bumpVersion(currentVersion: string, bumpType: VersionBump): string {
  const parsed = parseVersion(currentVersion);
  if (!parsed) {
    throw new Error(`Invalid version format: ${currentVersion}`);
  }

  switch (bumpType) {
    case 'patch':
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
    case 'minor':
      return `${parsed.major}.${parsed.minor + 1}.0`;
    case 'major':
      return `${parsed.major + 1}.0.0`;
    default:
      throw new Error(`Invalid bump type: ${bumpType}`);
  }
}

/**
 * Find package by name
 */
function findPackage(packageName: string): string | null {
  try {
    const result = execSync(
      `find packages -name package.json -type f -exec grep -l '"name": "${packageName}"' {} \\;`,
      {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
      }
    ).trim();

    return result || null;
  } catch {
    return null;
  }
}

/**
 * Determine changelog section based on bump type
 */
function getChangelogSection(bumpType: VersionBump): string {
  switch (bumpType) {
    case 'major':
      return '### Changed'; // Breaking changes
    case 'minor':
      return '### Added'; // New features
    case 'patch':
      return '### Fixed'; // Bug fixes
    default:
      return '### Changed';
  }
}

/**
 * Add changelog entry for package version bump
 */
function addChangelogEntry(packageName: string, oldVersion: string, newVersion: string, bumpType: VersionBump): void {
  try {
    const changelog = readFileSync(CHANGELOG_PATH, 'utf-8');
    
    // Find the [Unreleased] section
    const unreleasedMatch = changelog.match(/## \[Unreleased\]\s*\n/);
    if (!unreleasedMatch) {
      console.warn('⚠️  Could not find [Unreleased] section in CHANGELOG.md');
      return;
    }
    
    const unreleasedIndex = unreleasedMatch.index! + unreleasedMatch[0].length;
    const section = getChangelogSection(bumpType);
    
    // Find the section (Added, Changed, Fixed, etc.)
    const sectionRegex = new RegExp(`(${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s*\\n`, 'g');
    let sectionIndex = -1;
    let match;
    
    // Search from [Unreleased] onwards
    const afterUnreleased = changelog.substring(unreleasedIndex);
    sectionRegex.lastIndex = 0;
    match = sectionRegex.exec(afterUnreleased);
    
    if (match) {
      sectionIndex = unreleasedIndex + match.index + match[0].length;
    } else {
      // Section doesn't exist, add it after [Unreleased]
      sectionIndex = unreleasedIndex;
    }
    
    // Create changelog entry
    // Map bump type to more descriptive text
    const bumpDescription = bumpType === 'major' ? 'major version bump (breaking changes)' 
      : bumpType === 'minor' ? 'minor version bump (new features)'
      : 'patch version bump (bug fixes)';
    const entry = `- **${packageName}**: Version ${newVersion} - ${bumpDescription}\n`;
    
    // Insert entry
    const before = changelog.substring(0, sectionIndex);
    const after = changelog.substring(sectionIndex);
    
    // If section doesn't exist, add it
    let newContent: string;
    if (sectionIndex === unreleasedIndex) {
      newContent = before + section + '\n\n' + entry + '\n' + after;
    } else {
      newContent = before + entry + after;
    }
    
    writeFileSync(CHANGELOG_PATH, newContent);
    console.log(`✅ Added CHANGELOG.md entry for ${packageName} ${newVersion}`);
  } catch (error) {
    console.warn(`⚠️  Could not update CHANGELOG.md: ${error}`);
    console.warn('   Please manually add a changelog entry');
  }
}

/**
 * Bump package version
 */
function bumpPackageVersion(packageName: string, bumpType: VersionBump, updateChangelog: boolean = true): void {
  console.log(`🔄 Bumping ${packageName} version (${bumpType})...\n`);

  // Find package.json
  const packageJsonPath = findPackage(packageName);
  if (!packageJsonPath) {
    console.error(`❌ Package ${packageName} not found`);
    process.exit(1);
  }

  const fullPath = join(ROOT_DIR, packageJsonPath);
  const packageJson = JSON.parse(readFileSync(fullPath, 'utf-8'));

  if (!packageJson.version) {
    console.error(`❌ Package ${packageName} has no version field`);
    process.exit(1);
  }

  const currentVersion = packageJson.version;
  const newVersion = bumpVersion(currentVersion, bumpType);

  console.log(`  Current version: ${currentVersion}`);
  console.log(`  New version: ${newVersion}\n`);

  // Update package.json
  packageJson.version = newVersion;
  writeFileSync(fullPath, JSON.stringify(packageJson, null, 2) + '\n');

  console.log(`✅ Updated ${packageJsonPath}`);
  
  // Update CHANGELOG.md if requested
  if (updateChangelog) {
    addChangelogEntry(packageName, currentVersion, newVersion, bumpType);
  } else {
    console.log(`\n💡 Next steps:`);
    console.log(`   1. Review the changes in ${packageJsonPath}`);
    console.log(`   2. Update CHANGELOG.md with the version bump`);
    console.log(`   3. Commit the changes`);
  }
}

// Main
const args = process.argv.slice(2);

if (args.length < 2 || args.length > 3) {
  console.error('Usage: tsx scripts/version/bump-package-version.ts <package-name> <patch|minor|major> [--no-changelog]');
  console.error('\nExamples:');
  console.error('  tsx scripts/version/bump-package-version.ts @quantbot/utils patch');
  console.error('  tsx scripts/version/bump-package-version.ts @quantbot/storage minor');
  console.error('  tsx scripts/version/bump-package-version.ts @quantbot/core major');
  console.error('  tsx scripts/version/bump-package-version.ts @quantbot/utils patch --no-changelog');
  process.exit(1);
}

const [packageName, bumpType, ...flags] = args;
const updateChangelog = !flags.includes('--no-changelog');

if (!['patch', 'minor', 'major'].includes(bumpType)) {
  console.error(`❌ Invalid bump type: ${bumpType}. Must be one of: patch, minor, major`);
  process.exit(1);
}

bumpPackageVersion(packageName, bumpType as VersionBump, updateChangelog);

