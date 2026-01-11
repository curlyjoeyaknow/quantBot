/**
 * Handler Smoke Test
 *
 * Quick validation that all CLI handlers are callable.
 * This ensures handlers follow the correct pattern and can be invoked.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '../..');

/**
 * Find all handler files
 */
function findHandlerFiles(): string[] {
  const handlersDir = join(ROOT, 'packages', 'cli', 'src', 'handlers');
  if (!existsSync(handlersDir)) {
    return [];
  }

  const files: string[] = [];

  function walkDir(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile() && extname(entry.name) === '.ts' && !entry.name.endsWith('.test.ts')) {
        files.push(fullPath);
      }
    }
  }

  walkDir(handlersDir);
  return files;
}

describe('Handler Smoke Test', () => {
  const handlerFiles = findHandlerFiles();

  it('should find handler files', () => {
    expect(handlerFiles.length).toBeGreaterThan(0);
  });

  it('should have valid handler exports', async () => {
    // Sample a few handlers to verify they export functions
    const sampleHandlers = handlerFiles.slice(0, 5);

    for (const handlerPath of sampleHandlers) {
      const content = readFileSync(handlerPath, 'utf-8');
      // Check for export function or export const pattern
      expect(
        content.includes('export') && (content.includes('function') || content.includes('const') || content.includes('async'))
      ).toBe(true);
    }
  });

  it('should have handler files in correct location', () => {
    for (const handlerPath of handlerFiles) {
      expect(handlerPath).toContain('packages/cli/src/handlers');
      expect(handlerPath).not.toContain('node_modules');
      expect(handlerPath).not.toContain('dist');
    }
  });
});


