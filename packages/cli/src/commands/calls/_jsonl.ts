import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function ensureEmptyFile(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, '', 'utf8');
}

export async function appendJsonl(filePath: string, obj: unknown): Promise<void> {
  const line = JSON.stringify(obj) + '\n';
  await fs.appendFile(filePath, line, 'utf8');
}

export function safeError(e: unknown) {
  if (e instanceof Error) {
    return { name: e.name, message: e.message, stack: e.stack };
  }
  return { name: 'UnknownError', message: String(e) };
}

export function joinOut(outDir: string, name: string): string {
  return path.join(outDir, name);
}
