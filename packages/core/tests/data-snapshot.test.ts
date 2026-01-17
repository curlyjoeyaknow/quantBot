import { describe, it, expect, beforeEach } from 'vitest';
import {
  createDataSnapshot,
  InMemoryDataSnapshotRepository,
  DataSnapshotService,
} from '../src/data-snapshot.js';

describe('createDataSnapshot', () => {
  it('should create snapshot with hash', () => {
    const data = { value: 42 };
    const snapshot = createDataSnapshot('snap-1', 'test', data);

    expect(snapshot.snapshotId).toBe('snap-1');
    expect(snapshot.source).toBe('test');
    expect(snapshot.snapshotHash).toBeTruthy();
    expect(snapshot.createdAt).toBeTruthy();
  });

  it('should include metadata', () => {
    const data = { value: 42 };
    const metadata = { rowCount: 100, description: 'Test data' };
    const snapshot = createDataSnapshot('snap-1', 'test', data, metadata);

    expect(snapshot.metadata).toEqual(metadata);
  });
});

describe('InMemoryDataSnapshotRepository', () => {
  let repo: InMemoryDataSnapshotRepository;

  beforeEach(() => {
    repo = new InMemoryDataSnapshotRepository();
  });

  it('should store and retrieve snapshots', async () => {
    const snapshot = createDataSnapshot('snap-1', 'test', { value: 42 });

    await repo.put(snapshot);

    const retrieved = await repo.get('snap-1');
    expect(retrieved).toEqual(snapshot);
  });

  it('should retrieve by hash', async () => {
    const snapshot = createDataSnapshot('snap-1', 'test', { value: 42 });

    await repo.put(snapshot);

    const retrieved = await repo.getByHash(snapshot.snapshotHash);
    expect(retrieved).toEqual(snapshot);
  });

  it('should list by source', async () => {
    const snap1 = createDataSnapshot('snap-1', 'source-a', { value: 1 });
    const snap2 = createDataSnapshot('snap-2', 'source-a', { value: 2 });
    const snap3 = createDataSnapshot('snap-3', 'source-b', { value: 3 });

    await repo.put(snap1);
    await repo.put(snap2);
    await repo.put(snap3);

    const sourceA = await repo.listBySource('source-a');
    expect(sourceA).toHaveLength(2);

    const sourceB = await repo.listBySource('source-b');
    expect(sourceB).toHaveLength(1);
  });

  it('should delete snapshots', async () => {
    const snapshot = createDataSnapshot('snap-1', 'test', { value: 42 });

    await repo.put(snapshot);

    let retrieved = await repo.get('snap-1');
    expect(retrieved).toBeTruthy();

    await repo.delete('snap-1');

    retrieved = await repo.get('snap-1');
    expect(retrieved).toBeNull();
  });
});

describe('DataSnapshotService', () => {
  let repo: InMemoryDataSnapshotRepository;
  let service: DataSnapshotService;

  beforeEach(() => {
    repo = new InMemoryDataSnapshotRepository();
    service = new DataSnapshotService(repo);
  });

  it('should create and store snapshots', async () => {
    const data = { value: 42 };
    const snapshot = await service.snapshot('snap-1', 'test', data);

    expect(snapshot.snapshotId).toBe('snap-1');
    expect(snapshot.source).toBe('test');

    const retrieved = await service.get('snap-1');
    expect(retrieved).toEqual(snapshot);
  });

  it('should deduplicate by hash', async () => {
    const data = { value: 42 };

    const snap1 = await service.snapshot('snap-1', 'test', data);
    const snap2 = await service.snapshot('snap-2', 'test', data); // Same data

    // Should return existing snapshot
    expect(snap2.snapshotId).toBe(snap1.snapshotId);
    expect(snap2.snapshotHash).toBe(snap1.snapshotHash);
  });

  it('should check existence', async () => {
    const data = { value: 42 };

    let exists = await service.exists('snap-1');
    expect(exists).toBe(false);

    await service.snapshot('snap-1', 'test', data);

    exists = await service.exists('snap-1');
    expect(exists).toBe(true);
  });

  it('should find by hash', async () => {
    const data = { value: 42 };
    const snapshot = await service.snapshot('snap-1', 'test', data);

    const found = await service.findByHash(snapshot.snapshotHash);
    expect(found).toEqual(snapshot);
  });

  it('should list by source', async () => {
    await service.snapshot('snap-1', 'source-a', { value: 1 });
    await service.snapshot('snap-2', 'source-a', { value: 2 });
    await service.snapshot('snap-3', 'source-b', { value: 3 });

    const sourceA = await service.listBySource('source-a');
    expect(sourceA.length).toBeGreaterThanOrEqual(2);
  });
});
