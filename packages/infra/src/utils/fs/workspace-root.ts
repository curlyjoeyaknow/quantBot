import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

const workspaceRootCache = new Map<string, string>();

function hasWorkspaceConfig(dir: string): boolean {
  const workspaceFile = join(dir, 'pnpm-workspace.yaml');
  if (existsSync(workspaceFile)) {
    return true;
  }

  const packageFile = join(dir, 'package.json');
  if (!existsSync(packageFile)) {
    return false;
  }

  try {
    const pkg = JSON.parse(readFileSync(packageFile, 'utf8')) as {
      workspaces?: unknown;
      pnpm?: { workspace?: unknown };
    };
    return Boolean(pkg.workspaces || pkg.pnpm?.workspace);
  } catch {
    return false;
  }
}

/**
 * Find workspace root by walking up from a start directory.
 * Caches the result for faster subsequent lookups.
 */
export function findWorkspaceRoot(startDir: string = process.cwd()): string {
  const normalizedStart = resolve(startDir);
  if (workspaceRootCache.has(normalizedStart)) {
    return workspaceRootCache.get(normalizedStart)!;
  }

  const visited: string[] = [];
  let current = normalizedStart;

  while (true) {
    visited.push(current);

    if (hasWorkspaceConfig(current)) {
      for (const dir of visited) {
        workspaceRootCache.set(dir, current);
      }
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  for (const dir of visited) {
    workspaceRootCache.set(dir, normalizedStart);
  }
  return normalizedStart;
}

export function clearWorkspaceRootCache(): void {
  workspaceRootCache.clear();
}
