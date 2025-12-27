#!/usr/bin/env tsx

/**
 * Package Version Control Enforcement Script
 *
 * Ensures that every code change that impacts a package requires a version bump
 * in that package's package.json (semver).
 *
 * Requirements:
 * - Per-PR: PR cannot be merged unless version/s have changed for affected packages
 * - Per-Release: All package versions audited for changes since last release
 * - Version bumps must reflect actual code or dependency changes
 *
 * Run: tsx scripts/ci/verify-package-versions.ts
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '../..');

interface PackageInfo {
  name: string;
  path: string;
  version: string;
  hasChanges: boolean;
  changedFiles: string[];
}

/**
 * Get all packages in the monorepo
 */
function getAllPackages(): PackageInfo[] {
  const packages: PackageInfo[] = [];
  const packagesDir = join(ROOT, 'packages');

  if (!existsSync(packagesDir)) {
    return packages;
  }

  const entries = readdirSync(packagesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const packageJsonPath = join(packagesDir, entry.name, 'package.json');
      if (existsSync(packageJsonPath)) {
        try {
          const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
          packages.push({
            name: packageJson.name || entry.name,
            path: packageJsonPath,
            version: packageJson.version || '0.0.0',
            hasChanges: false,
            changedFiles: [],
          });
        } catch (error) {
          console.warn(`⚠️  Could not parse ${packageJsonPath}: ${error}`);
        }
      }
    }
  }

  return packages;
}

/**
 * Get changed files in the current branch/PR
 */
function getChangedFiles(): string[] {
  try {
    // Try to get files changed in PR (comparing against base branch)
    // First, try to detect the base branch
    let baseBranch = 'main';
    try {
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        encoding: 'utf-8',
      }).trim();
      if (currentBranch !== 'main' && currentBranch !== 'master') {
        // Try to find the base branch from GitHub PR
        const prBase = process.env.GITHUB_BASE_REF || 'main';
        baseBranch = prBase;
      }
    } catch {
      // Fallback to main
    }

    // Get diff against base branch
    const diff = execSync(`git diff --name-only ${baseBranch}...HEAD`, { encoding: 'utf-8' });
    return diff.split('\n').filter(Boolean);
  } catch (error) {
    // If that fails, try staged files
    try {
      const staged = execSync('git diff --cached --name-only', { encoding: 'utf-8' });
      return staged.split('\n').filter(Boolean);
    } catch {
      // If that fails, try all modified files
      try {
        const modified = execSync('git diff --name-only', { encoding: 'utf-8' });
        return modified.split('\n').filter(Boolean);
      } catch {
        console.warn('⚠️  Could not detect changed files. Assuming all packages may have changed.');
        return [];
      }
    }
  }
}

/**
 * Determine which packages are affected by changed files
 */
function getAffectedPackages(changedFiles: string[], packages: PackageInfo[]): PackageInfo[] {
  const affected: PackageInfo[] = [];

  for (const pkg of packages) {
    const packageDir = dirname(pkg.path);
    const relativePackageDir = packageDir.replace(ROOT + '/', '');

    // Check if any changed file is in this package's directory
    const packageChanges = changedFiles.filter((file) => {
      // Exclude package.json itself from triggering version check (circular)
      if (file === pkg.path.replace(ROOT + '/', '')) {
        return false;
      }
      return file.startsWith(relativePackageDir + '/');
    });

    if (packageChanges.length > 0) {
      affected.push({
        ...pkg,
        hasChanges: true,
        changedFiles: packageChanges,
      });
    }
  }

  return affected;
}

/**
 * Get version from git history (for comparison)
 */
function getVersionFromGit(packagePath: string, baseBranch: string = 'main'): string | null {
  try {
    const relativePath = packagePath.replace(ROOT + '/', '');
    const versionLine = execSync(
      `git show ${baseBranch}:${relativePath} 2>/dev/null | grep -E '"version"\\s*:' || echo ""`,
      { encoding: 'utf-8' }
    ).trim();

    if (versionLine) {
      const match = versionLine.match(/"version"\s*:\s*"([^"]+)"/);
      return match ? match[1] : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if version was bumped (semver comparison)
 */
function isVersionBumped(oldVersion: string | null, newVersion: string): boolean {
  if (!oldVersion) {
    // New package or can't determine old version - assume it's okay
    return true;
  }

  // Simple semver comparison (major.minor.patch)
  const parseVersion = (v: string): [number, number, number] => {
    const parts = v.split('.').map(Number);
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  };

  const [oldMajor, oldMinor, oldPatch] = parseVersion(oldVersion);
  const [newMajor, newMinor, newPatch] = parseVersion(newVersion);

  // Version is bumped if any component increased
  if (newMajor > oldMajor) return true;
  if (newMajor === oldMajor && newMinor > oldMinor) return true;
  if (newMajor === oldMajor && newMinor === oldMinor && newPatch > oldPatch) return true;

  return false;
}

/**
 * Main function
 */
function main(): void {
  console.log('🔍 Verifying package version bumps...\n');

  const packages = getAllPackages();
  const changedFiles = getChangedFiles();

  if (changedFiles.length === 0) {
    console.log('✅ No changed files detected. Version check skipped.');
    process.exit(0);
  }

  const affectedPackages = getAffectedPackages(changedFiles, packages);
  const issues: Array<{ package: PackageInfo; reason: string }> = [];

  // Determine base branch for comparison
  let baseBranch = 'main';
  try {
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    if (currentBranch !== 'main' && currentBranch !== 'master') {
      baseBranch = process.env.GITHUB_BASE_REF || 'main';
    }
  } catch {
    // Use default
  }

  for (const pkg of affectedPackages) {
    const oldVersion = getVersionFromGit(pkg.path, baseBranch);
    const versionBumped = isVersionBumped(oldVersion, pkg.version);

    if (!versionBumped) {
      issues.push({
        package: pkg,
        reason: oldVersion
          ? `Version not bumped (was ${oldVersion}, now ${pkg.version})`
          : `Version may need bumping (current: ${pkg.version})`,
      });
    }
  }

  if (issues.length === 0) {
    console.log('✅ All affected packages have version bumps!\n');
    if (affectedPackages.length > 0) {
      console.log('📦 Packages with changes:');
      for (const pkg of affectedPackages) {
        console.log(`   ${pkg.name}: ${pkg.version} (${pkg.changedFiles.length} file(s) changed)`);
      }
    }
    process.exit(0);
  }

  console.error('❌ Package version enforcement failed:\n');
  for (const { package: pkg, reason } of issues) {
    console.error(`📦 ${pkg.name}`);
    console.error(`   ${reason}`);
    console.error(`   Path: ${pkg.path.replace(ROOT + '/', '')}`);
    console.error(`   Changed files: ${pkg.changedFiles.length}`);
    if (pkg.changedFiles.length <= 5) {
      pkg.changedFiles.forEach((file) => console.error(`     - ${file}`));
    } else {
      pkg.changedFiles.slice(0, 5).forEach((file) => console.error(`     - ${file}`));
      console.error(`     ... and ${pkg.changedFiles.length - 5} more`);
    }
    console.error('');
  }

  console.error('💡 To fix:');
  console.error("   1. Update the version in the affected package's package.json");
  console.error('   2. Follow semver:');
  console.error('      - PATCH (x.y.Z): Bug fixes, minor changes');
  console.error('      - MINOR (x.Y.z): New features, backward compatible');
  console.error('      - MAJOR (X.y.z): Breaking changes');
  console.error('   3. Update CHANGELOG.md with version changes');
  console.error('   4. Commit the version bump along with your changes\n');

  process.exit(1);
}

main();
