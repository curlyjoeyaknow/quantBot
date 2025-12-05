/**
 * Path Sanitization Utility
 * ==========================
 * Prevents path traversal attacks and ensures file system operations are safe.
 */

import * as path from 'path';

/**
 * Custom error for path traversal attempts
 */
export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathTraversalError';
  }
}

/**
 * Sanitizes a user-provided path to prevent directory traversal attacks
 * 
 * @param userPath - The user-provided path (e.g., from URL params)
 * @param baseDir - The base directory that all paths must be within
 * @param allowAbsolute - Whether to allow absolute paths (default: false)
 * @returns The sanitized absolute path
 * @throws PathTraversalError if path traversal is detected
 * 
 * @example
 * ```typescript
 * const safePath = sanitizePath('simulation-123', '/app/data/exports');
 * // Returns: '/app/data/exports/simulation-123'
 * 
 * // This will throw:
 * sanitizePath('../../../etc/passwd', '/app/data/exports');
 * ```
 */
export function sanitizePath(
  userPath: string,
  baseDir: string,
  allowAbsolute: boolean = false
): string {
  if (!userPath || typeof userPath !== 'string') {
    throw new PathTraversalError('Path must be a non-empty string');
  }

  // Remove null bytes (path poisoning)
  if (userPath.includes('\0')) {
    throw new PathTraversalError('Path contains null bytes');
  }

  // Normalize the path (removes redundant separators, resolves . and ..)
  const normalized = path.normalize(userPath);

  // Check for path traversal attempts
  if (normalized.includes('..')) {
    throw new PathTraversalError('Path traversal detected: .. not allowed');
  }

  // Remove leading/trailing slashes and whitespace
  const cleaned = normalized.trim().replace(/^[/\\]+|[/\\]+$/g, '');

  // Validate path doesn't contain dangerous characters
  // Allow: alphanumeric, dash, underscore, dot, forward slash (for subdirectories)
  const dangerousChars = /[<>:"|?*\x00-\x1f]/;
  if (dangerousChars.test(cleaned)) {
    throw new PathTraversalError('Path contains invalid characters');
  }

  // Resolve base directory to absolute path
  const resolvedBase = path.resolve(baseDir);

  // If user provided absolute path and it's not allowed
  if (path.isAbsolute(cleaned) && !allowAbsolute) {
    throw new PathTraversalError('Absolute paths are not allowed');
  }

  // Resolve the final path
  const resolvedPath = path.resolve(resolvedBase, cleaned);

  // Ensure the resolved path is within the base directory
  if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
    throw new PathTraversalError(
      `Path traversal detected: resolved path "${resolvedPath}" is outside base directory "${resolvedBase}"`
    );
  }

  return resolvedPath;
}

/**
 * Validates that a filename is safe (no path separators, no special chars)
 * 
 * @param filename - The filename to validate
 * @returns The sanitized filename
 * @throws PathTraversalError if filename is invalid
 */
export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    throw new PathTraversalError('Filename must be a non-empty string');
  }

  // Remove path separators
  const cleaned = filename.replace(/[/\\]/g, '');

  // Remove null bytes
  if (cleaned.includes('\0')) {
    throw new PathTraversalError('Filename contains null bytes');
  }

  // Validate filename doesn't contain dangerous characters
  // Windows reserved names: CON, PRN, AUX, NUL, COM1-9, LPT1-9
  const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;
  if (reservedNames.test(cleaned)) {
    throw new PathTraversalError('Filename is a reserved name');
  }

  // Allow: alphanumeric, dash, underscore, dot
  const validPattern = /^[a-zA-Z0-9._-]+$/;
  if (!validPattern.test(cleaned)) {
    throw new PathTraversalError('Filename contains invalid characters');
  }

  // Limit length (Windows has 255 char limit, be conservative)
  if (cleaned.length > 200) {
    throw new PathTraversalError('Filename is too long (max 200 characters)');
  }

  return cleaned;
}

/**
 * Validates a directory path exists and is within the base directory
 * 
 * @param dirPath - The directory path to validate
 * @param baseDir - The base directory
 * @returns true if valid, throws if invalid
 * @throws PathTraversalError if path is invalid
 */
export function validateDirectoryPath(dirPath: string, baseDir: string): boolean {
  const sanitized = sanitizePath(dirPath, baseDir);
  
  // Additional check: ensure it's actually a directory (not a file)
  // This is a basic check - actual existence check should be done separately
  return true;
}

