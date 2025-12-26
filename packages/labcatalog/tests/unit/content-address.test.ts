/**
 * Content addressing tests - Hash-based IDs
 */

import { describe, it, expect } from 'vitest';
import {
  hashContent,
  generateSliceManifestId,
  generateRunId,
  hashFileContent,
  hashSliceSpec,
} from '../../src/content-address.js';
import type { SliceManifestV1 } from '@quantbot/core';

describe('Content Addressing', () => {
  describe('hashContent', () => {
    it('should generate deterministic hash', () => {
      const hash1 = hashContent('test');
      const hash2 = hashContent('test');

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(16); // Truncated to 16 chars
    });

    it('should generate different hashes for different inputs', () => {
      const hash1 = hashContent('test1');
      const hash2 = hashContent('test2');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('generateSliceManifestId', () => {
    it('should generate deterministic manifest ID', () => {
      const manifest: SliceManifestV1 = {
        version: 1,
        manifestId: '',
        createdAtIso: '2024-01-01T00:00:00Z',
        run: {
          runId: 'run-123',
          createdAtIso: '2024-01-01T00:00:00Z',
        },
        spec: {
          dataset: 'candles',
          chain: 'sol',
          timeRange: {
            startIso: '2024-01-01T00:00:00Z',
            endIso: '2024-01-02T00:00:00Z',
          },
        },
        layout: {
          baseUri: 'file://./catalog',
          subdirTemplate: '{dataset}/chain={chain}',
        },
        parquetFiles: [],
        summary: {
          totalFiles: 0,
        },
        integrity: {
          specHash: 'abc123',
        },
      };

      const id1 = generateSliceManifestId(manifest);
      const id2 = generateSliceManifestId(manifest);

      expect(id1).toBe(id2);
      expect(id1).toHaveLength(16);
    });
  });

  describe('generateRunId', () => {
    it('should generate deterministic run ID', () => {
      const context = {
        strategyId: 'PT2_SL25',
        seed: '123',
        createdAtIso: '2024-01-01T00:00:00Z',
      };

      const id1 = generateRunId(context);
      const id2 = generateRunId(context);

      expect(id1).toBe(id2);
      expect(id1).toHaveLength(16);
    });
  });

  describe('hashFileContent', () => {
    it('should hash string content', () => {
      const hash = hashFileContent('test content');
      expect(hash).toHaveLength(64); // Full SHA-256 hash
    });

    it('should hash Buffer content', () => {
      const buffer = Buffer.from('test content', 'utf-8');
      const hash = hashFileContent(buffer);
      expect(hash).toHaveLength(64);
    });
  });

  describe('hashSliceSpec', () => {
    it('should generate deterministic spec hash', () => {
      const spec = {
        dataset: 'candles',
        chain: 'sol',
        timeRange: {
          startIso: '2024-01-01T00:00:00Z',
          endIso: '2024-01-02T00:00:00Z',
        },
      };

      const hash1 = hashSliceSpec(spec);
      const hash2 = hashSliceSpec(spec);

      expect(hash1).toBe(hash2);
    });
  });
});
