import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ArtifactStoreAdapter } from '../../src/adapters/artifact-store-adapter.js';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ArtifactStoreAdapter (integration)', () => {
  const testDir = join(tmpdir(), `artifact-store-test-${Date.now()}`);
  const manifestDb = join(testDir, 'manifest.sqlite');
  const artifactsRoot = join(testDir, 'artifacts');
  const testDataPath = join(testDir, 'test-data.csv');

  let adapter: ArtifactStoreAdapter;

  beforeAll(() => {
    // Create test directories
    mkdirSync(testDir, { recursive: true });
    mkdirSync(artifactsRoot, { recursive: true });

    // Create test CSV file
    writeFileSync(
      testDataPath,
      'alert_ts_utc,chain,mint,alert_id\n2025-05-01T00:00:00Z,solana,ABC123,alert-1\n'
    );

    // Create adapter
    adapter = new ArtifactStoreAdapter(manifestDb, artifactsRoot);
  });

  afterAll(() => {
    // Cleanup test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should check availability', async () => {
    const available = await adapter.isAvailable();
    expect(available).toBe(true);
  });

  it('should publish and retrieve artifact', async () => {
    // Publish artifact
    const publishResult = await adapter.publishArtifact({
      artifactType: 'test_artifact',
      schemaVersion: 1,
      logicalKey: 'test/integration/key1',
      dataPath: testDataPath,
      writerName: 'integration-test',
      writerVersion: '1.0.0',
      gitCommit: 'test-commit-123',
      gitDirty: false,
      tags: { test: 'integration' },
    });

    expect(publishResult.success).toBe(true);
    expect(publishResult.deduped).toBe(false);
    expect(publishResult.artifactId).toBeDefined();

    // Retrieve artifact
    const artifact = await adapter.getArtifact(publishResult.artifactId!);
    expect(artifact.artifactId).toBe(publishResult.artifactId);
    expect(artifact.artifactType).toBe('test_artifact');
    expect(artifact.logicalKey).toBe('test/integration/key1');
    expect(artifact.status).toBe('active');
  });

  it('should deduplicate identical artifacts', async () => {
    // Publish first artifact
    const result1 = await adapter.publishArtifact({
      artifactType: 'test_artifact',
      schemaVersion: 1,
      logicalKey: 'test/dedup/key1',
      dataPath: testDataPath,
      writerName: 'integration-test',
      writerVersion: '1.0.0',
      gitCommit: 'test-commit-123',
      gitDirty: false,
    });

    expect(result1.deduped).toBe(false);
    expect(result1.artifactId).toBeDefined();

    // Publish same artifact again (should deduplicate)
    const result2 = await adapter.publishArtifact({
      artifactType: 'test_artifact',
      schemaVersion: 1,
      logicalKey: 'test/dedup/key1',
      dataPath: testDataPath,
      writerName: 'integration-test',
      writerVersion: '1.0.0',
      gitCommit: 'test-commit-123',
      gitDirty: false,
    });

    expect(result2.deduped).toBe(true);
    expect(result2.existingArtifactId).toBe(result1.artifactId);
  });

  it('should list artifacts with filters', async () => {
    // Publish artifact with tags
    await adapter.publishArtifact({
      artifactType: 'test_artifact',
      schemaVersion: 1,
      logicalKey: 'test/list/key1',
      dataPath: testDataPath,
      writerName: 'integration-test',
      writerVersion: '1.0.0',
      gitCommit: 'test-commit-123',
      gitDirty: false,
      tags: { environment: 'test', purpose: 'integration' },
    });

    // List artifacts
    const artifacts = await adapter.listArtifacts({
      artifactType: 'test_artifact',
      status: 'active',
      limit: 10,
    });

    expect(artifacts.length).toBeGreaterThan(0);
    expect(artifacts.every((a) => a.artifactType === 'test_artifact')).toBe(true);
    expect(artifacts.every((a) => a.status === 'active')).toBe(true);
  });

  it('should find artifacts by logical key', async () => {
    // Publish artifact
    const publishResult = await adapter.publishArtifact({
      artifactType: 'test_artifact',
      schemaVersion: 1,
      logicalKey: 'test/find/unique-key',
      dataPath: testDataPath,
      writerName: 'integration-test',
      writerVersion: '1.0.0',
      gitCommit: 'test-commit-123',
      gitDirty: false,
    });

    // Find by logical key
    const artifacts = await adapter.findByLogicalKey('test_artifact', 'test/find/unique-key');

    expect(artifacts.length).toBeGreaterThan(0);
    expect(artifacts[0].artifactId).toBe(publishResult.artifactId);
    expect(artifacts[0].logicalKey).toBe('test/find/unique-key');
  });

  it('should track lineage', async () => {
    // Publish input artifact
    const input1 = await adapter.publishArtifact({
      artifactType: 'test_artifact',
      schemaVersion: 1,
      logicalKey: 'test/lineage/input1',
      dataPath: testDataPath,
      writerName: 'integration-test',
      writerVersion: '1.0.0',
      gitCommit: 'test-commit-123',
      gitDirty: false,
    });

    // Publish output artifact with lineage
    const output = await adapter.publishArtifact({
      artifactType: 'test_artifact',
      schemaVersion: 1,
      logicalKey: 'test/lineage/output1',
      dataPath: testDataPath,
      inputArtifactIds: [input1.artifactId!],
      writerName: 'integration-test',
      writerVersion: '1.0.0',
      gitCommit: 'test-commit-123',
      gitDirty: false,
    });

    // Get lineage
    const lineage = await adapter.getLineage(output.artifactId!);

    expect(lineage.artifactId).toBe(output.artifactId);
    expect(lineage.inputs.length).toBe(1);
    expect(lineage.inputs[0].artifactId).toBe(input1.artifactId);
  });

  it('should get downstream artifacts', async () => {
    // Publish input artifact
    const input = await adapter.publishArtifact({
      artifactType: 'test_artifact',
      schemaVersion: 1,
      logicalKey: 'test/downstream/input1',
      dataPath: testDataPath,
      writerName: 'integration-test',
      writerVersion: '1.0.0',
      gitCommit: 'test-commit-123',
      gitDirty: false,
    });

    // Publish output artifact
    const output = await adapter.publishArtifact({
      artifactType: 'test_artifact',
      schemaVersion: 1,
      logicalKey: 'test/downstream/output1',
      dataPath: testDataPath,
      inputArtifactIds: [input.artifactId!],
      writerName: 'integration-test',
      writerVersion: '1.0.0',
      gitCommit: 'test-commit-123',
      gitDirty: false,
    });

    // Get downstream
    const downstream = await adapter.getDownstream(input.artifactId!);

    expect(downstream.length).toBeGreaterThan(0);
    expect(downstream.some((a) => a.artifactId === output.artifactId)).toBe(true);
  });

  it('should supersede artifacts', async () => {
    // Publish old artifact
    const old = await adapter.publishArtifact({
      artifactType: 'test_artifact',
      schemaVersion: 1,
      logicalKey: 'test/supersede/old',
      dataPath: testDataPath,
      writerName: 'integration-test',
      writerVersion: '1.0.0',
      gitCommit: 'test-commit-123',
      gitDirty: false,
    });

    // Publish new artifact
    const newArtifact = await adapter.publishArtifact({
      artifactType: 'test_artifact',
      schemaVersion: 1,
      logicalKey: 'test/supersede/new',
      dataPath: testDataPath,
      writerName: 'integration-test',
      writerVersion: '1.0.0',
      gitCommit: 'test-commit-456',
      gitDirty: false,
    });

    // Supersede old with new
    await adapter.supersede(newArtifact.artifactId!, old.artifactId!);

    // Verify old artifact is superseded
    const oldArtifact = await adapter.getArtifact(old.artifactId!);
    expect(oldArtifact.status).toBe('superseded');
  });
});

