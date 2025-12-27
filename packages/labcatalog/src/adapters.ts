/**
 * Catalog Adapters - Abstraction for storage operations
 *
 * Adapters handle actual FS/DB operations.
 * Catalog API is pure - adapters are swappable.
 */

import type { SliceManifestV1 } from '@quantbot/core';
import type { RunManifest, CatalogRootManifest } from './manifest.js';

/**
 * Catalog adapter interface
 *
 * Handles all storage operations for the catalog.
 * Implementations can use filesystem, S3, database, etc.
 */
export interface CatalogAdapter {
  /**
   * Read file content
   *
   * @param path - File path
   * @returns File content as string
   */
  readFile(path: string): Promise<string>;

  /**
   * Write file content
   *
   * @param path - File path
   * @param content - File content
   */
  writeFile(path: string, content: string): Promise<void>;

  /**
   * Check if file exists
   *
   * @param path - File path
   * @returns True if file exists
   */
  exists(path: string): Promise<boolean>;

  /**
   * Create directory (recursive)
   *
   * @param path - Directory path
   */
  mkdir(path: string): Promise<void>;

  /**
   * List files in directory
   *
   * @param path - Directory path
   * @returns Array of file names
   */
  readdir(path: string): Promise<string[]>;

  /**
   * List directories in directory
   *
   * @param path - Directory path
   * @returns Array of directory names
   */
  readdirDirs(path: string): Promise<string[]>;

  /**
   * Remove file or directory
   *
   * @param path - Path to remove
   */
  remove(path: string): Promise<void>;
}

/**
 * File system catalog adapter
 *
 * Implementation using Node.js fs/promises.
 */
export class FileSystemCatalogAdapter implements CatalogAdapter {
  private readonly basePath: string;

  constructor(basePath: string = './catalog') {
    this.basePath = basePath;
  }

  async readFile(path: string): Promise<string> {
    const { readFile } = await import('fs/promises');
    return await readFile(path, 'utf-8');
  }

  async writeFile(path: string, content: string): Promise<void> {
    const { writeFile, mkdir } = await import('fs/promises');
    const { dirname } = await import('path');
    // Ensure directory exists
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf-8');
  }

  async exists(path: string): Promise<boolean> {
    const { access } = await import('fs/promises');
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(path: string): Promise<void> {
    const { mkdir } = await import('fs/promises');
    await mkdir(path, { recursive: true });
  }

  async readdir(path: string): Promise<string[]> {
    const { readdir } = await import('fs/promises');
    try {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.filter((e) => e.isFile()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  async readdirDirs(path: string): Promise<string[]> {
    const { readdir } = await import('fs/promises');
    try {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  async remove(path: string): Promise<void> {
    const { rm } = await import('fs/promises');
    await rm(path, { recursive: true, force: true });
  }
}
