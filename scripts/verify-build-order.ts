#!/usr/bin/env tsx
/**
 * Build Order Verification Script
 *
 * Validates that packages are built in the correct dependency order.
 * Checks for:
 * - Dependencies built before dependents
 * - Circular dependencies
 * - Missing dependencies
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

interface PackageInfo {
  name: string;
  path: string;
  dependencies: string[];
  workspaceDependencies: string[];
}

// Expected build order (from build-ordering.mdc)
const EXPECTED_BUILD_ORDER = [
  '@quantbot/core',
  '@quantbot/utils',
  '@quantbot/storage',
  '@quantbot/observability',
  '@quantbot/api-clients',
  '@quantbot/ohlcv',
  '@quantbot/analytics',
  '@quantbot/jobs', // Online boundary - depends on api-clients, ohlcv, storage
  '@quantbot/ingestion', // Depends on jobs for OHLCV fetching
  '@quantbot/simulation',
  '@quantbot/workflows',
] as const;

// Remaining packages (can be built after the ordered packages)
const REMAINING_PACKAGES = ['@quantbot/cli'] as const;

const ALL_PACKAGES = [...EXPECTED_BUILD_ORDER, ...REMAINING_PACKAGES] as const;

function readPackageJson(packagePath: string): PackageInfo | null {
  const packageJsonPath = join(packagePath, 'package.json');
  try {
    if (!statSync(packageJsonPath).isFile()) {
      return null;
    }
    const content = readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content) as {
      name: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };

    // Extract workspace dependencies (those starting with @quantbot/)
    const workspaceDependencies = Object.keys(allDeps)
      .filter((dep) => dep.startsWith('@quantbot/'))
      .filter((dep) => allDeps[dep] === 'workspace:*');

    return {
      name: pkg.name,
      path: packagePath,
      dependencies: Object.keys(allDeps),
      workspaceDependencies,
    };
  } catch (error) {
    // Silently skip if package.json doesn't exist
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    console.error(`Failed to read ${packageJsonPath}:`, error);
    return null;
  }
}

function getAllPackages(): PackageInfo[] {
  const packagesDir = join(process.cwd(), 'packages');
  const entries = readdirSync(packagesDir, { withFileTypes: true });

  const packages: PackageInfo[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const packagePath = join(packagesDir, entry.name);
      const pkg = readPackageJson(packagePath);
      if (pkg) {
        packages.push(pkg);
      }
    }
  }

  return packages;
}

function getBuildOrderIndex(packageName: string): number {
  const index = EXPECTED_BUILD_ORDER.indexOf(packageName as any);
  if (index >= 0) {
    return index;
  }
  // Remaining packages come after the first 8
  return EXPECTED_BUILD_ORDER.length + REMAINING_PACKAGES.indexOf(packageName as any);
}

function checkBuildOrder(packages: PackageInfo[]): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const packageMap = new Map(packages.map((pkg) => [pkg.name, pkg]));

  // Check each package's dependencies
  for (const pkg of packages) {
    const pkgIndex = getBuildOrderIndex(pkg.name);

    for (const dep of pkg.workspaceDependencies) {
      const depIndex = getBuildOrderIndex(dep);

      // Check if dependency exists
      if (!packageMap.has(dep)) {
        errors.push(`Package ${pkg.name} depends on ${dep}, but ${dep} is not found in packages/`);
        continue;
      }

      // Check if dependency is built before dependent
      if (depIndex >= pkgIndex) {
        errors.push(
          `Package ${pkg.name} (index ${pkgIndex}) depends on ${dep} (index ${depIndex}), but ${dep} is built after ${pkg.name}`
        );
      }

      // Warn if dependency is in remaining packages but should be in ordered list
      if (
        REMAINING_PACKAGES.includes(dep as any) &&
        EXPECTED_BUILD_ORDER.includes(pkg.name as any)
      ) {
        warnings.push(
          `Package ${pkg.name} (in ordered list) depends on ${dep} (in remaining packages). Consider moving ${dep} to ordered list.`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function checkCircularDependencies(packages: PackageInfo[]): {
  valid: boolean;
  cycles: string[][];
} {
  const packageMap = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(packageName: string, path: string[]): void {
    if (recursionStack.has(packageName)) {
      // Found a cycle
      const cycleStart = path.indexOf(packageName);
      cycles.push([...path.slice(cycleStart), packageName]);
      return;
    }

    if (visited.has(packageName)) {
      return;
    }

    visited.add(packageName);
    recursionStack.add(packageName);

    const pkg = packageMap.get(packageName);
    if (pkg) {
      for (const dep of pkg.workspaceDependencies) {
        if (packageMap.has(dep)) {
          dfs(dep, [...path, packageName]);
        }
      }
    }

    recursionStack.delete(packageName);
  }

  for (const pkg of packages) {
    if (!visited.has(pkg.name)) {
      dfs(pkg.name, []);
    }
  }

  return {
    valid: cycles.length === 0,
    cycles,
  };
}

function main(): void {
  console.log('🔍 Verifying build order...\n');

  const packages = getAllPackages();
  console.log(`Found ${packages.length} packages:\n`);

  for (const pkg of packages) {
    console.log(`  - ${pkg.name}`);
    if (pkg.workspaceDependencies.length > 0) {
      console.log(`    Dependencies: ${pkg.workspaceDependencies.join(', ')}`);
    }
  }

  console.log('\n');

  // Check build order
  const buildOrderResult = checkBuildOrder(packages);
  if (!buildOrderResult.valid) {
    console.error('❌ Build order validation failed:\n');
    for (const error of buildOrderResult.errors) {
      console.error(`  - ${error}`);
    }
  } else {
    console.log('✅ Build order validation passed');
  }

  if (buildOrderResult.warnings.length > 0) {
    console.log('\n⚠️  Warnings:\n');
    for (const warning of buildOrderResult.warnings) {
      console.warn(`  - ${warning}`);
    }
  }

  // Check for circular dependencies
  const circularResult = checkCircularDependencies(packages);
  if (!circularResult.valid) {
    console.error('\n❌ Circular dependencies detected:\n');
    for (const cycle of circularResult.cycles) {
      console.error(`  - ${cycle.join(' → ')}`);
    }
  } else {
    console.log('\n✅ No circular dependencies detected');
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  if (buildOrderResult.valid && circularResult.valid) {
    console.log('✅ All checks passed! Build order is correct.\n');
    process.exit(0);
  } else {
    console.error('❌ Build order verification failed!\n');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
