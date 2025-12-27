#!/usr/bin/env tsx
/**
 * Release Package Version Audit
 * 
 * Audits all package versions for a release and generates a summary
 * for release notes. Compares current versions with the previous release.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '../..');

interface PackageVersion {
  name: string;
  version: string;
  path: string;
}

interface VersionChange {
  package: string;
  oldVersion: string | null;
  newVersion: string;
  changeType: 'new' | 'unchanged' | 'patch' | 'minor' | 'major';
}

/**
 * Get all packages with their versions
 */
function getAllPackages(): PackageVersion[] {
  const packages: PackageVersion[] = [];
  
  try {
    const result = execSync(
      `find packages -name package.json -type f`,
      {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
      }
    );

    for (const packageJsonPath of result.trim().split('\n').filter(Boolean)) {
      const fullPath = join(ROOT_DIR, packageJsonPath);
      try {
        const packageJson = JSON.parse(readFileSync(fullPath, 'utf-8'));
        if (packageJson.name && packageJson.version) {
          packages.push({
            name: packageJson.name,
            version: packageJson.version,
            path: packageJsonPath,
          });
        }
      } catch {
        // Skip invalid package.json files
      }
    }
  } catch {
    // If find fails, try alternative approach
  }

  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get package version from a git tag/commit
 */
function getPackageVersionFromGit(packagePath: string, ref: string): string | null {
  try {
    const result = execSync(
      `git show ${ref}:${packagePath} 2>/dev/null`,
      {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
      }
    );
    const packageJson = JSON.parse(result);
    return packageJson.version || null;
  } catch {
    return null;
  }
}

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
 * Determine change type between two versions
 */
function getChangeType(oldVersion: string | null, newVersion: string): VersionChange['changeType'] {
  if (!oldVersion) return 'new';
  if (oldVersion === newVersion) return 'unchanged';

  const old = parseVersion(oldVersion);
  const new_ = parseVersion(newVersion);

  if (!old || !new_) return 'unchanged';

  if (new_.major > old.major) return 'major';
  if (new_.minor > old.minor) return 'minor';
  if (new_.patch > old.patch) return 'patch';

  return 'unchanged';
}

/**
 * Get the latest release tag
 */
function getLatestReleaseTag(): string | null {
  try {
    const result = execSync(
      `git tag --sort=-version:refname | grep -E '^v?[0-9]+\\.[0-9]+\\.[0-9]+$' | head -1`,
      {
        cwd: ROOT_DIR,
        encoding: 'utf-8',
      }
    );
    return result.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Audit package versions
 */
function auditPackageVersions(previousRef: string | null = null): VersionChange[] {
  const currentPackages = getAllPackages();
  const changes: VersionChange[] = [];

  // If no previous ref provided, try to find latest release tag
  if (!previousRef) {
    previousRef = getLatestReleaseTag();
  }

  // If still no ref, use HEAD~1 as fallback
  if (!previousRef) {
    previousRef = 'HEAD~1';
  }

  console.log(`📊 Auditing package versions...`);
  console.log(`   Comparing against: ${previousRef}\n`);

  for (const pkg of currentPackages) {
    const oldVersion = getPackageVersionFromGit(pkg.path, previousRef);
    const changeType = getChangeType(oldVersion, pkg.version);

    changes.push({
      package: pkg.name,
      oldVersion,
      newVersion: pkg.version,
      changeType,
    });
  }

  return changes;
}

/**
 * Generate release notes summary
 */
function generateReleaseNotesSummary(changes: VersionChange[]): string {
  const sections: string[] = [];

  // Group by change type
  const newPackages = changes.filter((c) => c.changeType === 'new');
  const majorChanges = changes.filter((c) => c.changeType === 'major');
  const minorChanges = changes.filter((c) => c.changeType === 'minor');
  const patchChanges = changes.filter((c) => c.changeType === 'patch');
  const unchanged = changes.filter((c) => c.changeType === 'unchanged');

  sections.push('## Package Version Summary\n');

  if (newPackages.length > 0) {
    sections.push('### New Packages');
    for (const change of newPackages) {
      sections.push(`- **${change.package}**: ${change.newVersion} (new)`);
    }
    sections.push('');
  }

  if (majorChanges.length > 0) {
    sections.push('### Major Version Updates (Breaking Changes)');
    for (const change of majorChanges) {
      sections.push(`- **${change.package}**: ${change.oldVersion} → ${change.newVersion}`);
    }
    sections.push('');
  }

  if (minorChanges.length > 0) {
    sections.push('### Minor Version Updates (New Features)');
    for (const change of minorChanges) {
      sections.push(`- **${change.package}**: ${change.oldVersion} → ${change.newVersion}`);
    }
    sections.push('');
  }

  if (patchChanges.length > 0) {
    sections.push('### Patch Version Updates (Bug Fixes)');
    for (const change of patchChanges) {
      sections.push(`- **${change.package}**: ${change.oldVersion} → ${change.newVersion}`);
    }
    sections.push('');
  }

  if (unchanged.length > 0) {
    sections.push(`### Unchanged Packages (${unchanged.length})`);
    for (const change of unchanged) {
      sections.push(`- ${change.package}: ${change.newVersion}`);
    }
    sections.push('');
  }

  // Summary statistics
  sections.push('### Summary');
  sections.push(`- Total packages: ${changes.length}`);
  sections.push(`- New packages: ${newPackages.length}`);
  sections.push(`- Major updates: ${majorChanges.length}`);
  sections.push(`- Minor updates: ${minorChanges.length}`);
  sections.push(`- Patch updates: ${patchChanges.length}`);
  sections.push(`- Unchanged: ${unchanged.length}`);

  return sections.join('\n');
}

/**
 * Main function
 */
function main() {
  const args = process.argv.slice(2);
  const previousRef = args[0] || null;

  console.log('🔍 Release Package Version Audit\n');

  const changes = auditPackageVersions(previousRef);

  // Display changes
  console.log('📦 Package Version Changes:\n');
  for (const change of changes) {
    if (change.changeType === 'new') {
      console.log(`  ✅ ${change.package}: ${change.newVersion} (new package)`);
    } else if (change.changeType === 'unchanged') {
      console.log(`  ⚪ ${change.package}: ${change.newVersion} (unchanged)`);
    } else {
      console.log(
        `  ${change.changeType === 'major' ? '🔴' : change.changeType === 'minor' ? '🟡' : '🟢'} ${change.package}: ${change.oldVersion} → ${change.newVersion} (${change.changeType})`
      );
    }
  }

  console.log('\n' + '='.repeat(60) + '\n');
  console.log('📝 Release Notes Summary:\n');
  console.log(generateReleaseNotesSummary(changes));

  // Exit with error if there are major changes (for CI)
  const hasMajorChanges = changes.some((c) => c.changeType === 'major');
  if (hasMajorChanges && process.env.CI) {
    console.log('\n⚠️  Major version changes detected. Ensure breaking changes are documented.');
  }
}

main();

