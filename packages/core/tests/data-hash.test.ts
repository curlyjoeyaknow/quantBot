import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  computeContentHash,
  InMemoryDataHashRepository,
  IdempotentIngestion,
} from '../src/data-hash.js';
import type { DataHash } from '../src/data-hash.js';

describe('computeContentHash', () => {
  it('should produce consistent hashes', () => {
    const data1 = { a: 1, b: 2 };
    const data2 = { b: 2, a: 1 }; // Different order

    const hash1 = computeContentHash(data1);
    const hash2 = computeContentHash(data2);

    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different data', () => {
    const data1 = { a: 1, b: 2 };
    const data2 = { a: 1, b: 3 };

    const hash1 = computeContentHash(data1);
    const hash2 = computeContentHash(data2);

    expect(hash1).not.toBe(hash2);
  });
});

describe('InMemoryDataHashRepository', () => {
  let repo: InMemoryDataHashRepository;

  beforeEach(() => {
    repo = new InMemoryDataHashRepository();
  });

  it('should store and retrieve hashes', async () => {
    const dataHash: DataHash = {
      dataId: 'test-1',
      contentHash: 'abc123',
      source: 'telegram',
      ingestedAt: Date.now(),
    };

    await repo.put(dataHash);

    const exists = await repo.exists('abc123');
    expect(exists).toBe(true);

    const retrieved = await repo.get('abc123');
    expect(retrieved).toEqual(dataHash);
  });

  it('should check existence correctly', async () => {
    const dataHash: DataHash = {
      dataId: 'test-1',
      contentHash: 'abc123',
      source: 'telegram',
      ingestedAt: Date.now(),
    };

    let exists = await repo.exists('abc123');
    expect(exists).toBe(false);

    await repo.put(dataHash);

    exists = await repo.exists('abc123');
    expect(exists).toBe(true);
  });

  it('should get hashes by source', async () => {
    const hash1: DataHash = {
      dataId: 'test-1',
      contentHash: 'abc123',
      source: 'telegram',
      ingestedAt: Date.now(),
    };

    const hash2: DataHash = {
      dataId: 'test-2',
      contentHash: 'def456',
      source: 'telegram',
      ingestedAt: Date.now(),
    };

    const hash3: DataHash = {
      dataId: 'test-3',
      contentHash: 'ghi789',
      source: 'birdeye',
      ingestedAt: Date.now(),
    };

    await repo.put(hash1);
    await repo.put(hash2);
    await repo.put(hash3);

    const telegramHashes = await repo.getBySource('telegram');
    expect(telegramHashes).toHaveLength(2);

    const birdeyeHashes = await repo.getBySource('birdeye');
    expect(birdeyeHashes).toHaveLength(1);
  });

  it('should delete hashes', async () => {
    const dataHash: DataHash = {
      dataId: 'test-1',
      contentHash: 'abc123',
      source: 'telegram',
      ingestedAt: Date.now(),
    };

    await repo.put(dataHash);

    let exists = await repo.exists('abc123');
    expect(exists).toBe(true);

    await repo.delete('abc123');

    exists = await repo.exists('abc123');
    expect(exists).toBe(false);
  });
});

describe('IdempotentIngestion', () => {
  let repo: InMemoryDataHashRepository;
  let ingestion: IdempotentIngestion<{ value: number }>;
  let ingestFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    repo = new InMemoryDataHashRepository();
    ingestion = new IdempotentIngestion(repo, 'test-source');
    ingestFn = vi.fn().mockResolvedValue(undefined);
  });

  it('should ingest new data', async () => {
    const data = { value: 42 };

    const result = await ingestion.ingest('test-1', data, ingestFn);

    expect(result.ingested).toBe(true);
    expect(result.contentHash).toBeTruthy();
    expect(ingestFn).toHaveBeenCalledWith(data);
  });

  it('should skip duplicate data', async () => {
    const data = { value: 42 };

    // First ingestion
    const result1 = await ingestion.ingest('test-1', data, ingestFn);
    expect(result1.ingested).toBe(true);
    expect(ingestFn).toHaveBeenCalledTimes(1);

    // Second ingestion (duplicate)
    const result2 = await ingestion.ingest('test-2', data, ingestFn);
    expect(result2.ingested).toBe(false);
    expect(result2.contentHash).toBe(result1.contentHash);
    expect(ingestFn).toHaveBeenCalledTimes(1); // Not called again
  });

  it('should check for duplicates without ingesting', async () => {
    const data = { value: 42 };

    let isDup = await ingestion.isDuplicate(data);
    expect(isDup).toBe(false);

    await ingestion.ingest('test-1', data, ingestFn);

    isDup = await ingestion.isDuplicate(data);
    expect(isDup).toBe(true);
  });

  it('should track ingestion statistics', async () => {
    const data1 = { value: 1 };
    const data2 = { value: 2 };
    const data3 = { value: 3 };

    await ingestion.ingest('test-1', data1, ingestFn);
    await ingestion.ingest('test-2', data2, ingestFn);
    await ingestion.ingest('test-3', data3, ingestFn);

    const stats = await ingestion.getStats();

    expect(stats.totalIngested).toBe(3);
    expect(stats.oldestIngestedAt).toBeTruthy();
    expect(stats.newestIngestedAt).toBeTruthy();
    expect(stats.newestIngestedAt!).toBeGreaterThanOrEqual(stats.oldestIngestedAt!);
  });
});

