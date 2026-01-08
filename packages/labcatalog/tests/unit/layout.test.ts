/**
 * Layout tests - Path conventions and naming
 */

import { describe, it, expect } from 'vitest';
import {
  getCatalogPaths,
  getSliceFilePath,
  getSliceManifestPath,
  getRunDirPath,
  getRunManifestPath,
  parseSliceFilePath,
  parseRunDirPath,
  sanitizeTokenId,
} from '../../src/layout.js';

describe('Catalog Layout', () => {
  describe('getCatalogPaths', () => {
    it('should generate correct catalog paths', () => {
      const paths = getCatalogPaths('./catalog');

      expect(paths.catalogRoot).toBe('./catalog');
      expect(paths.dataDir).toContain('catalog/data');
      expect(paths.barsDir).toContain('catalog/data/bars');
      expect(paths.runsDir).toContain('catalog/runs');
      expect(paths.rootManifestPath).toContain('catalog/manifest.json');
    });

    it('should handle custom base path', () => {
      const paths = getCatalogPaths('/var/catalog');

      expect(paths.catalogRoot).toBe('/var/catalog');
      expect(paths.barsDir).toContain('/var/catalog/data/bars');
    });
  });

  describe('getSliceFilePath', () => {
    it('should generate correct slice file path (without date partitioning)', () => {
      const path = getSliceFilePath(
        'So11111111111111111111111111111111111111112',
        '2024-01-01T00:00:00Z',
        '2024-01-02T00:00:00Z',
        './catalog',
        false
      );

      expect(path).toContain('catalog/data/bars');
      expect(path).toContain('So11111111111111111111111111111111111111112');
      expect(path).toContain('20240101'); // Date part
      expect(path).toContain('20240102'); // Date part
      expect(path).toContain('.parquet');
      // Should NOT contain date partition directory
      expect(path).not.toMatch(/\/2024-01-01\//);
    });

    it('should generate correct slice file path with date partitioning', () => {
      const path = getSliceFilePath(
        'So11111111111111111111111111111111111111112',
        '2024-01-15T00:00:00Z',
        '2024-01-15T23:59:59Z',
        './catalog',
        true
      );

      expect(path).toContain('catalog/data/bars');
      expect(path).toContain('2024-01-15'); // Date partition directory
      expect(path).toContain('So11111111111111111111111111111111111111112');
      expect(path).toContain('.parquet');
      // Should contain date partition in path structure
      expect(path).toMatch(/\/2024-01-15\//);
    });

    it('should use start date for date partitioning', () => {
      const path = getSliceFilePath(
        'So11111111111111111111111111111111111111112',
        '2024-01-15T00:00:00Z',
        '2024-01-16T23:59:59Z', // Spans two days
        './catalog',
        true
      );

      // Should use start date (2024-01-15) for partitioning
      expect(path).toContain('2024-01-15');
      expect(path).not.toContain('2024-01-16');
    });
  });

  describe('getSliceManifestPath', () => {
    it('should generate manifest path with token', () => {
      const path = getSliceManifestPath(
        'abc123',
        'So11111111111111111111111111111111111111112',
        './catalog'
      );

      expect(path).toContain('catalog/data/bars');
      expect(path).toContain('So11111111111111111111111111111111111111112');
      expect(path).toContain('abc123.manifest.json');
    });

    it('should generate manifest path without token', () => {
      const path = getSliceManifestPath('abc123', undefined, './catalog');

      expect(path).toContain('catalog/data/bars');
      expect(path).toContain('abc123.manifest.json');
      expect(path).not.toContain('So11111111111111111111111111111111111111112');
    });
  });

  describe('getRunDirPath', () => {
    it('should generate correct run directory path', () => {
      const path = getRunDirPath('run-123', './catalog');

      expect(path).toContain('catalog/runs');
      expect(path).toContain('run-123');
    });
  });

  describe('parseSliceFilePath', () => {
    it('should parse valid slice file path', () => {
      const path =
        '/catalog/data/bars/So11111111111111111111111111111111111111112/20240101T000000_20240102T000000.parquet';
      const parsed = parseSliceFilePath(path);

      expect(parsed).not.toBeNull();
      expect(parsed?.tokenId).toBe('So11111111111111111111111111111111111111112');
      expect(parsed?.startIso).toBe('2024-01-01T00:00:00');
      expect(parsed?.endIso).toBe('2024-01-02T00:00:00');
    });

    it('should return null for invalid path', () => {
      const parsed = parseSliceFilePath('/invalid/path');
      expect(parsed).toBeNull();
    });
  });

  describe('parseRunDirPath', () => {
    it('should parse valid run directory path', () => {
      const path = '/catalog/runs/run-123';
      const runId = parseRunDirPath(path);

      expect(runId).toBe('run-123');
    });

    it('should handle path with trailing slash', () => {
      const path = '/catalog/runs/run-123/';
      const runId = parseRunDirPath(path);

      expect(runId).toBe('run-123');
    });

    it('should return null for invalid path', () => {
      const runId = parseRunDirPath('/invalid/path');
      expect(runId).toBeNull();
    });
  });

  describe('sanitizeTokenId', () => {
    it('should sanitize token ID for filesystem', () => {
      const tokenId = 'So11111111111111111111111111111111111111112';
      const sanitized = sanitizeTokenId(tokenId);

      expect(sanitized).toBe('So11111111111111111111111111111111111111112');
    });

    it('should handle special characters', () => {
      const tokenId = 'So111111/111111111111111111111111111111111111112';
      const sanitized = sanitizeTokenId(tokenId);

      expect(sanitized).not.toContain('/');
      expect(sanitized).toContain('_');
    });
  });
});
