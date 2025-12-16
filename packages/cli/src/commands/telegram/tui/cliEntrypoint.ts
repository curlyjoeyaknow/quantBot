import path from 'node:path';
import fs from 'node:fs';
import { runTelegramTui } from './run.js';

function readArg(argv: string[], name: string): string | null {
  const idx = argv.indexOf(name);
  if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
  return null;
}

function readNum(argv: string[], name: string): number | null {
  const v = readArg(argv, name);
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function exists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/**
 * Find workspace root by walking up from current directory
 * looking for pnpm-workspace.yaml or package.json with workspace config
 */
function findWorkspaceRoot(startDir: string): string {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;

  while (current !== root) {
    const workspaceFile = path.join(current, 'pnpm-workspace.yaml');
    const packageFile = path.join(current, 'package.json');

    if (exists(workspaceFile)) {
      return current;
    }

    if (exists(packageFile)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
        if (pkg.workspaces || pkg.pnpm?.workspace) {
          return current;
        }
      } catch {
        // Continue searching
      }
    }

    current = path.dirname(current);
  }

  // Fallback to start directory if workspace root not found
  return startDir;
}

export async function runTelegramTuiFromCli(argv: string[]): Promise<void> {
  const cwd = process.cwd();
  const workspaceRoot = findWorkspaceRoot(cwd);

  // Helper to resolve paths: if relative, resolve against workspace root; if absolute, use as-is
  const resolvePath = (p: string): string => {
    if (path.isAbsolute(p)) return p;
    return path.resolve(workspaceRoot, p);
  };

  const normalizedPathRaw =
    readArg(argv, '--normalized') ??
    readArg(argv, '-n') ??
    path.join(workspaceRoot, 'data', 'normalized_messages.ndjson');

  const quarantinePathRaw =
    readArg(argv, '--quarantine') ??
    readArg(argv, '-q') ??
    path.join(workspaceRoot, 'data', 'quarantine.ndjson');

  const normalizedPath = resolvePath(normalizedPathRaw);
  const quarantinePath = resolvePath(quarantinePathRaw);

  const chatId = readArg(argv, '--chat') ?? null;
  const maxLines = readNum(argv, '--max') ?? readNum(argv, '-m') ?? 200000;

  if (!exists(normalizedPath)) {
    throw new Error(`normalized file not found: ${normalizedPath}`);
  }
  if (!exists(quarantinePath)) {
    throw new Error(`quarantine file not found: ${quarantinePath}`);
  }

  await runTelegramTui({
    normalizedPath,
    quarantinePath,
    chatId: chatId ?? undefined,
    maxLines: maxLines ?? undefined,
  });
}
