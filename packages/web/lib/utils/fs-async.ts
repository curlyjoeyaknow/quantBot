/**
 * Async File System Utilities
 * ============================
 * Async wrappers for file system operations
 */

import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Check if file or directory exists
 */
export async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read file as string
 */
export async function readFile(filePath: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
  return await fs.readFile(filePath, encoding);
}

/**
 * Write file
 */
export async function writeFile(filePath: string, data: string, encoding: BufferEncoding = 'utf8'): Promise<void> {
  return await fs.writeFile(filePath, data, encoding);
}

/**
 * Read directory
 */
export async function readdir(dirPath: string, options?: { withFileTypes?: boolean }): Promise<string[] | any[]> {
  if (options?.withFileTypes) {
    return await fs.readdir(dirPath, { withFileTypes: true });
  }
  return await fs.readdir(dirPath);
}

/**
 * Get file stats
 */
export async function stat(filePath: string) {
  return await fs.stat(filePath);
}

/**
 * Check if path is a directory
 */
export async function isDirectory(filePath: string): Promise<boolean> {
  try {
    const stats = await stat(filePath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if path is a file
 */
export async function isFile(filePath: string): Promise<boolean> {
  try {
    const stats = await stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

