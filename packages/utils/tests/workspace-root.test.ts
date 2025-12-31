import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { clearWorkspaceRootCache, findWorkspaceRoot } from '../src/fs/workspace-root';

describe('findWorkspaceRoot', () => {
  let rootDir: string;
  let nestedDir: string;

  beforeEach(() => {
    clearWorkspaceRootCache();
    rootDir = mkdtempSync(join(tmpdir(), 'workspace-root-'));
    nestedDir = join(rootDir, 'packages', 'app', 'src');
    mkdirSync(nestedDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
    clearWorkspaceRootCache();
  });

  it('detects the workspace root from a nested path and caches the result', () => {
    const workspaceFile = join(rootDir, 'pnpm-workspace.yaml');
    writeFileSync(workspaceFile, 'packages:\n  - "packages/*"\n');

    const detected = findWorkspaceRoot(nestedDir);
    expect(detected).toBe(rootDir);

    rmSync(workspaceFile, { force: true });

    const cached = findWorkspaceRoot(nestedDir);
    expect(cached).toBe(rootDir);
  });
});
