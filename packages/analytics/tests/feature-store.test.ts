import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryFeatureStore, createFeatureVersionHash } from '../src/feature-store.js';
import type { FeatureMetadata } from '../src/feature-store.js';

describe('InMemoryFeatureStore', () => {
  let store: InMemoryFeatureStore;

  beforeEach(() => {
    store = new InMemoryFeatureStore();
  });

  it('should store and retrieve features', async () => {
    const metadata: FeatureMetadata = {
      featureName: 'rsi',
      featureType: 'indicator',
      version: {
        version: 'v1',
        computedAt: Date.now(),
        configHash: 'abc123',
      },
      dependencies: [],
      parameters: { period: 14 },
    };

    await store.put('rsi', 1000, 50.5, metadata);

    const result = await store.get('rsi', 1000);
    expect(result).toBeDefined();
    expect(result?.value).toBe(50.5);
    expect(result?.metadata.version.version).toBe('v1');
  });

  it('should handle multiple versions', async () => {
    const metadata1: FeatureMetadata = {
      featureName: 'rsi',
      featureType: 'indicator',
      version: {
        version: 'v1',
        computedAt: 1000,
        configHash: 'abc123',
      },
      dependencies: [],
      parameters: { period: 14 },
    };

    const metadata2: FeatureMetadata = {
      featureName: 'rsi',
      featureType: 'indicator',
      version: {
        version: 'v2',
        computedAt: 2000,
        configHash: 'def456',
      },
      dependencies: [],
      parameters: { period: 21 },
    };

    await store.put('rsi', 1000, 50.5, metadata1);
    await store.put('rsi', 1000, 52.3, metadata2);

    // Get latest version (v2)
    const latest = await store.get('rsi', 1000);
    expect(latest?.value).toBe(52.3);
    expect(latest?.metadata.version.version).toBe('v2');

    // Get specific version (v1)
    const v1 = await store.get('rsi', 1000, 'v1');
    expect(v1?.value).toBe(50.5);
    expect(v1?.metadata.version.version).toBe('v1');
  });

  it('should list all versions', async () => {
    const metadata1: FeatureMetadata = {
      featureName: 'rsi',
      featureType: 'indicator',
      version: {
        version: 'v1',
        computedAt: 1000,
        configHash: 'abc123',
      },
      dependencies: [],
      parameters: { period: 14 },
    };

    const metadata2: FeatureMetadata = {
      featureName: 'rsi',
      featureType: 'indicator',
      version: {
        version: 'v2',
        computedAt: 2000,
        configHash: 'def456',
      },
      dependencies: [],
      parameters: { period: 21 },
    };

    await store.put('rsi', 1000, 50.5, metadata1);
    await store.put('rsi', 1000, 52.3, metadata2);

    const versions = await store.getVersions('rsi');
    expect(versions).toHaveLength(2);
    expect(versions[0].version).toBe('v2'); // Latest first
    expect(versions[1].version).toBe('v1');
  });

  it('should invalidate versions', async () => {
    const metadata: FeatureMetadata = {
      featureName: 'rsi',
      featureType: 'indicator',
      version: {
        version: 'v1',
        computedAt: Date.now(),
        configHash: 'abc123',
      },
      dependencies: [],
      parameters: { period: 14 },
    };

    await store.put('rsi', 1000, 50.5, metadata);

    // Should retrieve before invalidation
    let result = await store.get('rsi', 1000, 'v1');
    expect(result).toBeDefined();

    // Invalidate
    await store.invalidate('rsi', 'v1');

    // Should not retrieve after invalidation
    result = await store.get('rsi', 1000, 'v1');
    expect(result).toBeNull();
  });

  it('should get latest non-invalidated version', async () => {
    const metadata1: FeatureMetadata = {
      featureName: 'rsi',
      featureType: 'indicator',
      version: {
        version: 'v1',
        computedAt: 1000,
        configHash: 'abc123',
      },
      dependencies: [],
      parameters: { period: 14 },
    };

    const metadata2: FeatureMetadata = {
      featureName: 'rsi',
      featureType: 'indicator',
      version: {
        version: 'v2',
        computedAt: 2000,
        configHash: 'def456',
      },
      dependencies: [],
      parameters: { period: 21 },
    };

    await store.put('rsi', 1000, 50.5, metadata1);
    await store.put('rsi', 1000, 52.3, metadata2);

    // Invalidate v2
    await store.invalidate('rsi', 'v2');

    // Should fall back to v1
    const result = await store.get('rsi', 1000);
    expect(result?.value).toBe(50.5);
    expect(result?.metadata.version.version).toBe('v1');
  });

  it('should clear all data', async () => {
    const metadata: FeatureMetadata = {
      featureName: 'rsi',
      featureType: 'indicator',
      version: {
        version: 'v1',
        computedAt: Date.now(),
        configHash: 'abc123',
      },
      dependencies: [],
      parameters: { period: 14 },
    };

    await store.put('rsi', 1000, 50.5, metadata);

    let stats = store.getStats();
    expect(stats.featureCount).toBe(1);

    await store.clear();

    stats = store.getStats();
    expect(stats.featureCount).toBe(0);
    expect(stats.versionCount).toBe(0);
  });
});

describe('createFeatureVersionHash', () => {
  it('should create consistent hashes', () => {
    const params1 = { period: 14, source: 'close' };
    const params2 = { source: 'close', period: 14 }; // Different order

    const hash1 = createFeatureVersionHash(params1);
    const hash2 = createFeatureVersionHash(params2);

    expect(hash1).toBe(hash2);
  });

  it('should create different hashes for different parameters', () => {
    const params1 = { period: 14 };
    const params2 = { period: 21 };

    const hash1 = createFeatureVersionHash(params1);
    const hash2 = createFeatureVersionHash(params2);

    expect(hash1).not.toBe(hash2);
  });
});

